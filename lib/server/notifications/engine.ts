import "server-only";
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { z } from "zod";
import { notificationDecision, type NotificationEventType } from "../../notifications/policy.ts";
import { notificationMessageSchema, type NotificationMessageCode } from "../../notifications/contracts.ts";
import { evaluateCondition, type ConditionCheckpoint, type ConditionObservation } from "./transitions.ts";
import { notificationTransaction, readPolicy, appendChange } from "./database.ts";
import { lockTarget, type NotificationTarget } from "./targets.ts";
import { eventView, incidentView } from "./views.ts";

const observationSchema = z.strictObject({
  epoch: z.uuid(), fingerprint: z.string().min(1).max(512), checkedAt: z.number().int().nonnegative(), observedAt: z.number().int().nonnegative(),
  validUntil: z.number().int().nonnegative(), state: z.enum(["healthy", "attention", "unavailable", "unknown", "suppressed"]),
  severity: z.enum(["info", "warning", "critical"]), sourceSeverity: z.number().int().min(0).max(5).nullable(), confirmation: z.enum(["explicit", "sampled"]),
});
const inputSchema = z.strictObject({
  key: z.string().min(1).max(256).refine(value => !value.startsWith("$")), family: z.enum(["availability", "status", "health", "problems"]),
  source: z.enum(["zabbix", "probe", "vps", "signal"]), eventType: z.enum(["unavailable", "attention", "problem"]),
  messageCode: notificationMessageSchema, observation: observationSchema,
  resourceIdentity: z.string().min(1).max(256).optional(),
});
export type NotificationObservation = { key: string; family: "availability" | "status" | "health" | "problems"; source: "zabbix" | "probe" | "vps" | "signal"; eventType: Exclude<NotificationEventType, "recovery">; messageCode: NotificationMessageCode; observation: ConditionObservation; resourceIdentity?: string };

export async function recordNotificationObservations(target: NotificationTarget, input: NotificationObservation[], completeFamilies: string[], replay = false, signal?: AbortSignal) {
  const observations = z.array(inputSchema).max(5004).parse(input).sort((a, b) => a.key.localeCompare(b.key));
  if (new Set(observations.map(row => row.key)).size !== observations.length) throw new Error("duplicate_notification_condition");
  return notificationTransaction(async client => {
    const policy = await readPolicy(client, true);
    const current = await lockTarget(client, target);
    if (!current) return;
    const { rows: states } = await client.query("SELECT * FROM notification_target_state WHERE target_ref=$1 ORDER BY condition_key FOR UPDATE", [target.ref]);
    const lifecycle = states.find(row => row.condition_key === "$lifecycle");
    if (!lifecycle || lifecycle.epoch !== target.epoch) return;
    const checkedAt = Math.max(0, ...observations.map(row => row.observation.checkedAt));
    if (checkedAt && (checkedAt < (lifecycle.checkpoint.lastCheckedAt ?? 0) || checkedAt > Date.now())) return;
    const baselines = { ...(lifecycle.checkpoint.baselines ?? {}) } as Record<string, boolean>;
    const byKey = new Map(states.map(state => [state.condition_key, state]));
    const changes: { incidentId: string; eventId: string | null }[] = [];
    const identity = observations.find(row => row.resourceIdentity)?.resourceIdentity ?? lifecycle.checkpoint.resourceIdentity;
    if (identity && lifecycle.checkpoint.resourceIdentity && identity !== lifecycle.checkpoint.resourceIdentity) {
      const cancelled = await client.query("UPDATE notification_incident SET status='cancelled',closed_at=clock_timestamp(),changed_at=clock_timestamp(),message_code='monitor_changed' WHERE target_ref=$1 AND status='active' RETURNING id", [target.ref]);
      changes.push(...cancelled.rows.map(row => ({ incidentId: row.id as string, eventId: null })));
      await client.query("DELETE FROM notification_target_state WHERE target_ref=$1 AND condition_key<>'$lifecycle'", [target.ref]);
      byKey.clear(); for (const key of Object.keys(baselines)) delete baselines[key];
    }
    const sourceSuppressed = observations.find(row => row.key === "availability" && row.observation.state === "suppressed");
    if (sourceSuppressed) {
      for (const family of Object.keys(baselines)) delete baselines[family];
      for (const state of states) if (state.condition_key !== "$lifecycle" && !observations.some(row => row.key === state.condition_key)) {
        observations.push({ ...sourceSuppressed, key: state.condition_key, family: state.condition_key.startsWith("problem:") ? "problems" : sourceSuppressed.family });
      }
    }
    for (const row of observations) {
      const existing = byKey.get(row.key);
      const previous = existing?.checkpoint as ConditionCheckpoint | undefined;
      const decision = notificationDecision(policy, { targetRef: current.ref, critical: current.critical, monitoringEnabled: current.enabled,
        eventType: row.eventType, severity: row.observation.severity, sourceSeverity: row.observation.sourceSeverity });
      const recovery = notificationDecision(policy, { targetRef: current.ref, critical: current.critical, monitoringEnabled: current.enabled,
        eventType: "recovery", severity: "info", previouslyAnnounced: previous?.incident?.highestAnnouncedRank != null });
      const result = evaluateCondition(previous ?? null, { ...row.observation, state: current.enabled ? row.observation.state : "suppressed" }, {
        now: Date.now(), expectedEpoch: current.epoch, baseline: !baselines[row.family], eligible: decision.enabled, recoveryEnabled: recovery.enabled,
      });
      if (result.ignored) continue;
      let incidentId: string | null = existing?.incident_id ?? null;
      if (result.incidentAction === "opened" && result.checkpoint.incident) {
        const incident = result.checkpoint.incident; incidentId = randomUUID();
        await client.query(`INSERT INTO notification_incident(id,target_ref,condition_key,display_name,source,severity,source_severity,status,message_code,opened_at,confirmed_at)
          VALUES($1,$2,$3,$4,$5,$6,$7,'active',$8,$9,$10)`, [incidentId, target.ref, row.key, current.label, row.source, incident.severity, row.observation.sourceSeverity, row.messageCode, new Date(incident.startedAt), new Date(incident.confirmedAt)]);
      } else if (result.incidentAction && incidentId) {
        const status = result.incidentAction === "resolved" ? "resolved" : result.incidentAction === "cancelled" ? "cancelled" : "active";
        await client.query(`UPDATE notification_incident SET status=$2::text,severity=$3,source_severity=$4,message_code=$5,changed_at=clock_timestamp(),
          closed_at=CASE WHEN $2::text='active' THEN NULL ELSE clock_timestamp() END WHERE id=$1`,
        [incidentId, status, result.checkpoint.incident?.severity ?? result.previousIncident?.severity ?? row.observation.severity, row.observation.sourceSeverity,
          status === "resolved" ? "recovered" : status === "cancelled" ? "monitor_changed" : row.messageCode]);
      }
      let eventId: string | null = null;
      if (result.event && incidentId) {
        eventId = randomUUID(); const recovered = result.event === "recovered";
        const rank = result.checkpoint.incident?.highestAnnouncedRank ?? "closed";
        await client.query(`INSERT INTO notification_event(id,incident_id,transition_key,target_ref,display_name,event_type,transition,severity,source_severity,critical_at_occurrence,message_code,occurred_at,announce)
          VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
        [eventId, incidentId, `${incidentId}:${result.event}:${rank}`, target.ref, current.label, recovered ? "recovery" : row.eventType,
          result.event, recovered ? "info" : row.observation.severity, row.observation.sourceSeverity, current.critical,
          recovered ? "recovered" : row.messageCode, new Date(recovered ? row.observation.observedAt : result.checkpoint.incident!.startedAt), !replay]);
      }
      await client.query(`INSERT INTO notification_target_state(target_ref,condition_key,epoch,checkpoint,incident_id) VALUES($1,$2,$3,$4,$5)
        ON CONFLICT(target_ref,condition_key) DO UPDATE SET epoch=EXCLUDED.epoch,checkpoint=EXCLUDED.checkpoint,incident_id=EXCLUDED.incident_id,updated_at=clock_timestamp()`,
      [target.ref, row.key, current.epoch, JSON.stringify(result.checkpoint), result.checkpoint.incident ? incidentId : null]);
      if (result.incidentAction && incidentId) changes.push({ incidentId, eventId });
    }
    for (const family of completeFamilies) if (!sourceSuppressed && ["availability", "status", "health", "problems"].includes(family)) baselines[family] = true;
    await client.query("UPDATE notification_target_state SET checkpoint=$2,updated_at=clock_timestamp() WHERE target_ref=$1 AND condition_key='$lifecycle'", [target.ref, JSON.stringify({ baselines, resourceIdentity: identity, lastCheckedAt: Math.max(lifecycle.checkpoint.lastCheckedAt ?? 0, checkedAt) })]);
    // Lock the stream only after all target/incident/event writes; keep it until commit.
    for (const change of changes) {
      const incident = incidentView((await client.query("SELECT * FROM notification_incident WHERE id=$1", [change.incidentId])).rows[0]);
      const eventRow = change.eventId ? (await client.query("SELECT * FROM notification_event WHERE id=$1", [change.eventId])).rows[0] : null;
      const event = eventRow ? eventView({ ...eventRow, incident_status: incident.status }) : null;
      const revision = await appendChange(client, "incident", {});
      incident.revision = revision;
      if (event) { event.revision = revision; event.createdRevision = revision; }
      await client.query("UPDATE notification_incident SET revision=$2 WHERE id=$1", [change.incidentId, revision]);
      if (event) await client.query("UPDATE notification_event SET revision=$2,created_revision=$2 WHERE id=$1", [event.id, revision]);
      await client.query("UPDATE notification_change SET payload=$2 WHERE revision=$1", [revision, JSON.stringify({ incident, ...(event ? { event } : {}) })]);
    }
  }, false, signal);
}

export async function safelyRecordNotifications(target: NotificationTarget, observations: NotificationObservation[], families: string[], parentSignal?: AbortSignal) {
  const signal = AbortSignal.any([AbortSignal.timeout(2500), ...(parentSignal ? [parentSignal] : [])]);
  try { await recordNotificationObservations(target, observations, families, false, signal); }
  catch {
    // One bounded retry, with the original observation identity; recovery of a failed write is silent.
    try { await delay(75, undefined, { signal }); await recordNotificationObservations(target, observations, families, true, signal); }
    catch { console.error(JSON.stringify({ event: "notification_persistence_failed", targetRef: target.ref })); }
  }
}
