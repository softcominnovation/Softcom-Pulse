import "server-only";
import { z } from "zod";
import type { PoolClient } from "pg";
import { BffError } from "../bff.ts";
import { notificationTransaction, readPolicy, readStream, appendChange, type Stream } from "./database.ts";
import { notificationTargets, type NotificationTarget } from "./targets.ts";
import { notificationDecision, notificationRuntime } from "../../notifications/policy.ts";
import { notificationListQuery, notificationReadSchema, type HighlightedIncident, type NotificationEventView, type NotificationSnapshot, type NotificationChangeView, type NotificationChanges, type NotificationSourceHealth } from "../../notifications/contracts.ts";
import { eventView, incidentView, notificationDescription } from "./views.ts";
import type { NotificationDateRange } from "../../notifications/history-range.ts";

const incidentSelect = "SELECT i.*,e.metric_context,e.occurred_at AS context_occurred_at FROM notification_incident i LEFT JOIN LATERAL (SELECT metric_context,occurred_at FROM notification_event WHERE incident_id=i.id AND metric_context IS NOT NULL ORDER BY created_at DESC,id DESC LIMIT 1) e ON true";
const decimal = z.string().regex(/^\d{1,20}$/);
const cursorSchema = z.strictObject({ g: z.uuid(), r: decimal, scope: z.enum(["private", "public"]),
  end: decimal.optional(), delivery: decimal.optional(), time: z.iso.datetime().optional(), id: z.uuid().optional(), list: z.enum(["events", "incidents"]).optional(),
  from: z.iso.date().optional(), to: z.iso.date().optional() });
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
  const { rows } = await client.query("SELECT (SELECT count(*)::int FROM notification_event WHERE read_at IS NULL) AS unread,(SELECT count(*)::int FROM notification_incident WHERE status='active' AND dismissed_at IS NULL) AS active");
  return { unreadCount: rows[0].unread as number, activeCount: rows[0].active as number };
}
async function sourceHealth(client: PoolClient, targets: NotificationTarget[]): Promise<NotificationSourceHealth[]> {
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
  if (target.kind === "signal_service" && target.identity.targetId) return `${prefix}/servicos?signalTarget=${target.identity.targetId}&signalService=${target.id}#signal`;
  return `${prefix}/servicos`;
}
type Policy = Awaited<ReturnType<typeof readPolicy>>;
function indexTargets(targets: NotificationTarget[]) {
  return new Map(targets.map(target => [target.ref, target]));
}
function delivery(targets: ReadonlyMap<string, NotificationTarget>, events: NotificationEventView[], policy: Policy) {
  return events.map(event => {
    const target = targets.get(event.targetRef);
    const decision = notificationDecision(policy, { targetRef: event.targetRef, critical: target?.critical ?? false, monitoringEnabled: target?.enabled ?? false,
      eventType: event.eventType, severity: event.severity, sourceSeverity: event.sourceSeverity, previouslyAnnounced: true });
    const eligible = event.announce && !event.readAt && (event.eventType === "recovery" || event.incidentStatus === "active") && decision.enabled;
    return { ...event, toastEligible: eligible, sound: eligible ? decision.sound : false as const };
  });
}

// Look up only announced errors for the active (or changed) incidents.
async function highlightEvidence(client: PoolClient, ids?: string[]) {
  return (await client.query<{ id: string; ref: string; event_type: NotificationEventView["eventType"]; first_revision: string; source_severity: number | null }>(`
    SELECT i.id, i.target_ref AS ref, i.source_severity, e.event_type, e.created_revision AS first_revision
    FROM notification_incident i
    JOIN LATERAL (
      SELECT event_type, created_revision FROM notification_event
      WHERE incident_id=i.id AND announce AND severity='critical' AND transition IN ('opened','escalated')
      ORDER BY created_revision LIMIT 1
    ) e ON true
    WHERE i.dismissed_at IS NULL AND ${ids ? "i.id=ANY($1::uuid[])" : "i.status='active' AND i.severity='critical'"}`, ids ? [ids] : [])).rows;
}

function allowsHighlight(policy: Policy, target: NotificationTarget | undefined, eventType: NotificationEventView["eventType"], sourceSeverity: number | null) {
  return !!target && notificationDecision(policy, { targetRef: target.ref, critical: target.critical, monitoringEnabled: target.enabled,
    eventType, severity: "critical", sourceSeverity }).enabled;
}
async function highlightedIncidents(client: PoolClient, policy: Policy, targets: ReadonlyMap<string, NotificationTarget>): Promise<HighlightedIncident[]> {
  if (!policy.enabled) return [];
  const evidence = await highlightEvidence(client);
  return evidence.filter(row => allowsHighlight(policy, targets.get(row.ref), row.event_type, row.source_severity))
    .map(row => ({ incidentId: row.id, targetRef: row.ref }));
}

async function listWithClient(client: PoolClient, query: z.infer<typeof notificationListQuery> & { highlights?: "1" }, scope: Cursor["scope"], incidents = false, incidentId?: string, range?: NotificationDateRange): Promise<NotificationSnapshot> {
    const stream = await readStream(client), policy = await readPolicy(client);
    const paging = query.cursor ? parseCursor(query.cursor, stream, scope) : null;
    if (paging && (paging.list !== (incidents ? "incidents" : "events") || !paging.time || !paging.id)) throw new BffError(400, "invalid_notification_cursor");
    if (paging && (range ? paging.from !== range.from || paging.to !== (range.to ?? range.from) : paging.from || paging.to)) throw new BffError(400, "invalid_notification_cursor");
    const conditions: string[] = [], args: unknown[] = [];
    const parameter = (value: unknown) => { args.push(value); return `$${args.length}`; };
    const alias = incidents ? "i" : "e";
    if (query.targetRef) conditions.push(`${alias}.target_ref=${parameter(query.targetRef)}`);
    if (query.severity) conditions.push(`${alias}.severity=${parameter(query.severity)}`);
    if (query.state !== "all") conditions.push(`i.status=${parameter(query.state)}`);
    if (incidents && query.state === "active") conditions.push("i.dismissed_at IS NULL");
    if (!incidents && query.read === "unread") conditions.push("e.read_at IS NULL");
    if (incidentId) conditions.push(`i.id=${parameter(incidentId)}::uuid`);
    if (range) {
      conditions.push(`e.created_at >= (${parameter(range.from)}::date::timestamp AT TIME ZONE 'America/Fortaleza')`);
      conditions.push(`e.created_at < ((${parameter(range.to ?? range.from)}::date + 1)::timestamp AT TIME ZONE 'America/Fortaleza')`);
    }
    const time = incidents ? "i.opened_at" : "e.created_at";
    if (paging) conditions.push(`(${time},${alias}.id)<(${parameter(paging.time)}::timestamptz,${parameter(paging.id)}::uuid)`);
    const limit = parameter(query.limit + 1);
    const sql = incidents ? incidentSelect : "SELECT e.*,i.status AS incident_status FROM notification_event e JOIN notification_incident i ON i.id=e.incident_id";
    const rows = (await client.query(`${sql}${conditions.length ? " WHERE " + conditions.join(" AND ") : ""} ORDER BY ${time} DESC,${alias}.id DESC LIMIT ${limit}`, args)).rows;
    const hasMore = rows.length > query.limit, page = rows.slice(0, query.limit), last = page.at(-1);
    const cursor = { g: stream.generation, r: stream.revision, scope };
    const inventory = await notificationTargets(client), targets = indexTargets(inventory);
    return { ...(query.highlights ? { highlights: await highlightedIncidents(client, policy, targets) } : {}), events: incidents ? [] : delivery(targets, page.map(row => eventView(row, scope === "private")), policy), incidents: incidents ? page.map(row => incidentView(row, scope === "private")) : [],
      counts: await counts(client), syncCursor: encodeNotificationCursor(cursor), streamRevision: stream.revision,
      nextPageCursor: hasMore && last ? encodeNotificationCursor({ ...cursor, ...(range ? { from: range.from, to: range.to ?? range.from } : {}), list: incidents ? "incidents" : "events", time: (incidents ? last.opened_at : last.created_at).toISOString(), id: last.id }) : null,
      serverTime: new Date().toISOString(), runtime: notificationRuntime(policy, stream.delivery_revision), sources: await sourceHealth(client, inventory) };
}
export async function listNotifications(query: z.infer<typeof notificationListQuery> & { highlights?: "1" }, scope: Cursor["scope"] = "private", incidents = false, incidentId?: string): Promise<NotificationSnapshot> {
  return notificationTransaction(client => listWithClient(client, query, scope, incidents, incidentId), true);
}
export async function notificationHistory(query: { from: string; to?: string } & Omit<z.infer<typeof notificationListQuery>, "read" | "state">, scope: Cursor["scope"]) {
  return notificationTransaction(client => listWithClient(client, { ...query, read: "all", state: "all" }, scope, false, undefined, { from: query.from, to: query.to }), true);
}
export async function notificationDetail(id: string, scope: Cursor["scope"], incident = false, query = notificationListQuery.parse({})) {
  z.uuid().parse(id);
  if (incident) {
    return notificationTransaction(async client => {
      const history = await listWithClient(client, query, scope, false, id);
      const current = (await client.query(`${incidentSelect} WHERE i.id=$1`, [id])).rows[0];
      if (!current) throw new BffError(404, "notification_not_found");
      return { ...history, incident: incidentView(current, scope === "private"), targetHref: await targetHref(client, current.target_ref, scope) };
    }, true);
  }
  return notificationTransaction(async client => {
    const row = (await client.query("SELECT e.*,i.status AS incident_status FROM notification_event e JOIN notification_incident i ON i.id=e.incident_id WHERE e.id=$1", [id])).rows[0];
    if (!row) throw new BffError(404, "notification_not_found");
    const event = delivery(indexTargets(await notificationTargets(client, row.target_ref)), [eventView(row, scope === "private")], await readPolicy(client))[0];
    const incidentRow = (await client.query("SELECT * FROM notification_incident WHERE id=$1", [row.incident_id])).rows[0];
    return { event, incident: incidentView(incidentRow, scope === "private"), targetHref: await targetHref(client, row.target_ref, scope) };
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
    const targets = indexTargets(changes.some(change => change.payload.event || change.payload.incident?.severity === "critical") ? await notificationTargets(client) : []);
    const events = delivery(targets, changes.flatMap(change => change.payload.event ? [change.payload.event] : []), policy);
    // A client can read an old feed page after another screen discarded that incident.
    if (events.length) {
      const details = await client.query(`SELECT e.id,e.target_ref,e.message_code,e.source_severity,e.diagnostic,i.dismissed_at
        FROM notification_event e JOIN notification_incident i ON i.id=e.incident_id WHERE e.id=ANY($1::uuid[])`, [events.map(event => event.id)]);
      const current = new Map(details.rows.map(row => [row.id, row]));
      for (const event of events) {
        const row = current.get(event.id);
        if (row?.dismissed_at) { event.toastEligible = false; event.sound = false; }
        if (row && scope === "private" && event.messageCode === "problem") event.description = notificationDescription(row, true);
      }
    }
    const eventMap = new Map(events.map(event => [event.id, event]));
    for (const change of changes) if (change.payload.event) change.payload.event = eventMap.get(change.payload.event.id)!;
    const critical = changes.flatMap(change => {
      const incident = change.payload.incident;
      return incident?.status === "active" && incident.severity === "critical" ? [incident.id] : [];
    });
    if (critical.length) {
      const evidence = new Map((await highlightEvidence(client, critical)).map(row => [row.id, row]));
      for (const { payload, revision } of changes) {
        const incident = payload.incident;
        if (incident?.status !== "active" || incident.severity !== "critical") continue;
        const row = evidence.get(incident.id), target = targets.get(incident.targetRef);
        payload.highlighted = !!row && BigInt(row.first_revision) <= BigInt(revision)
          && allowsHighlight(policy, target, row.event_type, incident.sourceSeverity);
      }
    }
    const next = hasMore ? changes.at(-1)!.revision : end;
    return { changes, nextCursor: encodeNotificationCursor({ g: stream.generation, scope, r: next, ...(hasMore ? { end, delivery: stream.delivery_revision } : {}) }),
      hasMore, windowEnd: end, streamRevision: end, counts: cursor.end ? null : await counts(client),
      serverTime: new Date().toISOString(), runtime: notificationRuntime(policy, stream.delivery_revision) };
  }, true);
}
export async function dismissNotificationIncident(id: string, editor: string) {
  z.uuid().parse(id);
  return notificationTransaction(async client => {
    // Serialize with the queue cursor so it cannot insert another delivery after cancellation.
    await client.query("SELECT id FROM notification_webhook WHERE id=1 FOR UPDATE");
    const row = (await client.query("SELECT * FROM notification_incident WHERE id=$1 FOR UPDATE", [id])).rows[0];
    if (!row) throw new BffError(404, "notification_not_found");
    if (row.dismissed_at) return { incident: incidentView(row, true) };
    if (row.status !== "active") throw new BffError(409, "incident_already_closed");
    const updated = (await client.query("UPDATE notification_incident SET dismissed_at=clock_timestamp(),changed_at=clock_timestamp() WHERE id=$1 RETURNING *", [id])).rows[0];
    const incident = incidentView(updated);
    const unread = await client.query("SELECT id FROM notification_event WHERE incident_id=$1 AND read_at IS NULL ORDER BY id FOR UPDATE", [id]);
    await client.query("UPDATE notification_webhook_delivery SET outcome='dismissed',finished_at=now(),lease=NULL WHERE incident_id=$1 AND finished_at IS NULL", [id]);
    const revision = await appendChange(client, "incident", {});
    incident.revision = revision;
    await client.query("UPDATE notification_incident SET revision=$2 WHERE id=$1", [id, revision]);
    await client.query("UPDATE notification_change SET payload=$2 WHERE revision=$1", [revision, JSON.stringify({ incident, highlighted: false })]);
    if (unread.rows.length) await client.query("UPDATE notification_event SET read_at=clock_timestamp(),read_by=$2,revision=$3 WHERE id=ANY($1::uuid[])", [unread.rows.map(event => event.id), editor.slice(0, 254), revision]);
    return { incident: incidentView({ ...updated, revision }, true) };
  });
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
