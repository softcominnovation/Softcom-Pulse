import "server-only";
import { z } from "zod";
import type { PoolClient } from "pg";
import { BffError } from "../bff.ts";
import { notificationTransaction, readPolicy, readStream, appendChange, type Stream } from "./database.ts";
import { notificationTargets } from "./targets.ts";
import { notificationDecision, notificationRuntime } from "../../notifications/policy.ts";
import { notificationListQuery, notificationReadSchema, type NotificationEventView, type NotificationSnapshot, type NotificationChangeView, type NotificationChanges, type NotificationSourceHealth } from "../../notifications/contracts.ts";
import { eventView, incidentView } from "./views.ts";

const decimal = z.string().regex(/^\d{1,20}$/);
const cursorSchema = z.strictObject({ g: z.uuid(), r: decimal, scope: z.enum(["private", "public"]),
  end: decimal.optional(), delivery: decimal.optional(), time: z.iso.datetime().optional(), id: z.uuid().optional(), list: z.enum(["events", "incidents"]).optional() });
type Cursor = z.infer<typeof cursorSchema>;
export const encodeNotificationCursor = (cursor: Cursor) => Buffer.from(JSON.stringify(cursor)).toString("base64url");
function parseCursor(raw: string, stream: Stream, scope: Cursor["scope"]): Cursor {
  let cursor: Cursor;
  try { cursor = cursorSchema.parse(JSON.parse(Buffer.from(raw, "base64url").toString("utf8"))); }
  catch { throw new BffError(400, "invalid_notification_cursor"); }
  if (cursor.scope !== scope || BigInt(cursor.r) > BigInt(stream.revision) || (cursor.end && (BigInt(cursor.end) > BigInt(stream.revision) || BigInt(cursor.end) < BigInt(cursor.r)))) throw new BffError(400, "invalid_notification_cursor");
  if (cursor.g !== stream.generation || BigInt(cursor.r) < BigInt(stream.minimum_revision)) throw new BffError(409, "notification_resync_required");
  return cursor;
}
async function counts(client: PoolClient) {
  const { rows } = await client.query("SELECT (SELECT count(*)::int FROM notification_event WHERE read_at IS NULL) AS unread,(SELECT count(*)::int FROM notification_incident WHERE status='active') AS active");
  return { unreadCount: rows[0].unread as number, activeCount: rows[0].active as number };
}
async function sourceHealth(client: PoolClient): Promise<NotificationSourceHealth[]> {
  const targets = await notificationTargets(client);
  const rows = (await client.query("SELECT target_ref,checkpoint->>'lastCheckedAt' AS checked FROM notification_target_state WHERE condition_key='$lifecycle' AND target_ref=ANY($1::text[])", [targets.filter(target => target.enabled).map(target => target.ref)])).rows;
  const groups = new Map<NotificationSourceHealth["source"], number>();
  for (const row of rows) {
    const source = row.target_ref.startsWith("external_service:") ? "probe" : row.target_ref.startsWith("standalone_vps:") ? "vps" : row.target_ref.startsWith("signal_target:") ? "signal" : "zabbix";
    groups.set(source, Math.max(groups.get(source) ?? 0, Number(row.checked) || 0));
  }
  return [...groups].map(([source, at]) => ({ source, lastCheckedAt: at ? new Date(at).toISOString() : null, status: !at ? "awaiting" : Date.now() - at > (source === "zabbix" ? 120000 : 390000) ? "stale" : "receiving" }));
}
async function targetHref(client: PoolClient, ref: string, scope: Cursor["scope"]) {
  const target = (await notificationTargets(client, ref))[0];
  if (!target) return null;
  const prefix = scope === "public" ? "/monitor" : "";
  if (target.kind === "standalone_vps") return `${scope === "public" ? prefix : "/admin"}/vps/${target.id}`;
  if (target.kind === "external_service") return `${scope === "public" ? prefix : "/admin"}/aplicacoes`;
  return `${prefix}/servicos`;
}
async function delivery(client: PoolClient, events: NotificationEventView[], policy: Awaited<ReturnType<typeof readPolicy>>) {
  const targets = new Map((await notificationTargets(client)).map(target => [target.ref, target]));
  return events.map(event => {
    const target = targets.get(event.targetRef);
    const decision = notificationDecision(policy, { targetRef: event.targetRef, critical: target?.critical ?? false, monitoringEnabled: target?.enabled ?? false,
      eventType: event.eventType, severity: event.severity, sourceSeverity: event.sourceSeverity, previouslyAnnounced: true });
    const eligible = event.announce && !event.readAt && (event.eventType === "recovery" || event.incidentStatus === "active") && decision.enabled;
    return { ...event, toastEligible: eligible, sound: eligible ? decision.sound : false as const };
  });
}

async function listWithClient(client: PoolClient, query: z.infer<typeof notificationListQuery>, scope: Cursor["scope"], incidents = false, incidentId?: string): Promise<NotificationSnapshot> {
    const stream = await readStream(client), policy = await readPolicy(client);
    const paging = query.cursor ? parseCursor(query.cursor, stream, scope) : null;
    if (paging && (paging.list !== (incidents ? "incidents" : "events") || !paging.time || !paging.id)) throw new BffError(400, "invalid_notification_cursor");
    const conditions: string[] = [], args: unknown[] = [];
    const parameter = (value: unknown) => { args.push(value); return `$${args.length}`; };
    const alias = incidents ? "i" : "e";
    if (query.targetRef) conditions.push(`${alias}.target_ref=${parameter(query.targetRef)}`);
    if (query.severity) conditions.push(`${alias}.severity=${parameter(query.severity)}`);
    if (query.state !== "all") conditions.push(`i.status=${parameter(query.state)}`);
    if (!incidents && query.read === "unread") conditions.push("e.read_at IS NULL");
    if (incidentId) conditions.push(`i.id=${parameter(incidentId)}::uuid`);
    const time = incidents ? "i.opened_at" : "e.created_at";
    if (paging) conditions.push(`(${time},${alias}.id)<(${parameter(paging.time)}::timestamptz,${parameter(paging.id)}::uuid)`);
    const limit = parameter(query.limit + 1);
    const sql = incidents ? "SELECT i.* FROM notification_incident i" : "SELECT e.*,i.status AS incident_status FROM notification_event e JOIN notification_incident i ON i.id=e.incident_id";
    const rows = (await client.query(`${sql}${conditions.length ? " WHERE " + conditions.join(" AND ") : ""} ORDER BY ${time} DESC,${alias}.id DESC LIMIT ${limit}`, args)).rows;
    const hasMore = rows.length > query.limit, page = rows.slice(0, query.limit), last = page.at(-1);
    const cursor = { g: stream.generation, r: stream.revision, scope };
    return { events: incidents ? [] : await delivery(client, page.map(eventView), policy), incidents: incidents ? page.map(incidentView) : [],
      counts: await counts(client), syncCursor: encodeNotificationCursor(cursor), streamRevision: stream.revision,
      nextPageCursor: hasMore && last ? encodeNotificationCursor({ ...cursor, list: incidents ? "incidents" : "events", time: (incidents ? last.opened_at : last.created_at).toISOString(), id: last.id }) : null,
      serverTime: new Date().toISOString(), runtime: notificationRuntime(policy, stream.delivery_revision), sources: await sourceHealth(client) };
}
export async function listNotifications(query: z.infer<typeof notificationListQuery>, scope: Cursor["scope"] = "private", incidents = false, incidentId?: string): Promise<NotificationSnapshot> {
  return notificationTransaction(client => listWithClient(client, query, scope, incidents, incidentId), true);
}
export async function notificationDetail(id: string, scope: Cursor["scope"], incident = false, query = notificationListQuery.parse({})) {
  z.uuid().parse(id);
  if (incident) {
    return notificationTransaction(async client => {
      const history = await listWithClient(client, query, scope, false, id);
      const current = (await client.query("SELECT * FROM notification_incident WHERE id=$1", [id])).rows[0];
      if (!current) throw new BffError(404, "notification_not_found");
      return { ...history, incident: incidentView(current), targetHref: await targetHref(client, current.target_ref, scope) };
    }, true);
  }
  return notificationTransaction(async client => {
    const row = (await client.query("SELECT e.*,i.status AS incident_status FROM notification_event e JOIN notification_incident i ON i.id=e.incident_id WHERE e.id=$1", [id])).rows[0];
    if (!row) throw new BffError(404, "notification_not_found");
    const event = (await delivery(client, [eventView(row)], await readPolicy(client)))[0];
    const incidentRow = (await client.query("SELECT * FROM notification_incident WHERE id=$1", [row.incident_id])).rows[0];
    return { event, incident: incidentView(incidentRow), targetHref: await targetHref(client, row.target_ref, scope) };
  }, true);
}
export async function notificationChanges(after: string, limit: number, scope: Cursor["scope"]): Promise<NotificationChanges> {
  return notificationTransaction(async client => {
    const stream = await readStream(client), cursor = parseCursor(after, stream, scope), policy = await readPolicy(client);
    if (cursor.list) throw new BffError(400, "invalid_notification_cursor");
    if (cursor.delivery && cursor.delivery !== stream.delivery_revision) throw new BffError(409, "notification_resync_required");
    const end = cursor.end ?? stream.revision;
    const rows = (await client.query("SELECT revision,kind,payload FROM notification_change WHERE revision>$1 AND revision<=$2 ORDER BY revision LIMIT $3", [cursor.r, end, limit + 1])).rows;
    const hasMore = rows.length > limit;
    const changes = rows.slice(0, limit) as NotificationChangeView[];
    if (changes.some(change => ["policy_changed", "retention", "read_all"].includes(change.kind))) throw new BffError(409, "notification_resync_required");
    const events = await delivery(client, changes.flatMap(change => change.payload.event ? [change.payload.event] : []), policy);
    const eventMap = new Map(events.map(event => [event.id, event]));
    for (const change of changes) if (change.payload.event) change.payload.event = eventMap.get(change.payload.event.id)!;
    const next = hasMore ? changes.at(-1)!.revision : end;
    return { changes, nextCursor: encodeNotificationCursor({ g: stream.generation, scope, r: next, ...(hasMore ? { end, delivery: stream.delivery_revision } : {}) }),
      hasMore, windowEnd: end, streamRevision: end, counts: cursor.end ? null : await counts(client),
      serverTime: new Date().toISOString(), runtime: notificationRuntime(policy, stream.delivery_revision) };
  }, true);
}
export async function markNotificationsRead(body: unknown, editor: string) {
  const input = notificationReadSchema.parse(body);
  return notificationTransaction(async client => {
    const stream = await readStream(client);
    const cutoff = "allThrough" in input ? parseCursor(input.allThrough, stream, "private") : null;
    if (cutoff?.list) throw new BffError(400, "invalid_notification_cursor");
    const rows = (await client.query("SELECT id FROM notification_event WHERE read_at IS NULL AND " + (cutoff ? "created_revision<=$1" : "id=ANY($1::uuid[])") + " ORDER BY id FOR UPDATE", [cutoff ? cutoff.r : "ids" in input ? input.ids : []])).rows;
    if (rows.length) {
      const ids = rows.map(row => row.id);
      const revision = await appendChange(client, ids.length > 100 ? "read_all" : "read", { ids: ids.length > 100 ? [] : ids });
      await client.query("UPDATE notification_event SET read_at=clock_timestamp(),read_by=$2,revision=$3 WHERE id=ANY($1::uuid[])", [ids, editor.slice(0, 254), revision]);
    }
    const current = await readStream(client);
    return { counts: await counts(client), streamRevision: current.revision, syncCursor: encodeNotificationCursor({ g: current.generation, r: current.revision, scope: "private" }) };
  });
}
