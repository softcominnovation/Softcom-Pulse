import "server-only";
import { setTimeout as delay } from "node:timers/promises";
import { notificationText } from "../../notifications/contracts.ts";
import { getDatabase } from "../database.ts";
import { openProbeSecret } from "../probe/secret.ts";
import { notificationTransaction, readStream, webhookEligibleSql } from "./database.ts";
import { eventView } from "./views.ts";
import { diagnosticSchema } from "./webhook-diagnostic.ts";
import { webhookSecretContext } from "./webhook-settings.ts";
import { postWebhook, webhookRetryMs } from "./webhook-transport.ts";

const batchSize = 100;

function webhookBody(row: Record<string, unknown>) {
  const e = eventView(row);
  const { title, ...context } = diagnosticSchema.safeParse(row.diagnostic).data ?? {};
  return {
    schemaVersion: 1, eventId: e.id, incidentId: e.incidentId, eventType: e.eventType,
    transition: e.transition, severity: e.severity, source: row.source, sourceSeverity: e.sourceSeverity,
    occurredAt: e.occurredAt, createdAt: e.createdAt,
    resource: { ref: e.targetRef, kind: e.targetRef.split(":")[0], name: e.displayName, criticalAtOccurrence: e.criticalAtOccurrence },
    error: { code: e.messageCode, message: title ?? notificationText(e), context: { ...context, ...(e.metricContext ? { metric: e.metricContext } : {}) } },
  };
}

export function enqueueWebhookEvents(signal?: AbortSignal) {
  return notificationTransaction(async client => {
    const config = (await client.query("SELECT generation,cursor_revision FROM notification_webhook WHERE id=1 AND active FOR UPDATE")).rows[0];
    if (!config) return false;
    const { revision } = await readStream(client);
    if (revision === config.cursor_revision) return true;
    const { rows } = await client.query(`SELECT e.*, i.source FROM notification_event e JOIN notification_incident i ON i.id=e.incident_id
      WHERE i.dismissed_at IS NULL AND ${webhookEligibleSql} AND e.created_revision > $1 AND e.created_revision <= $2
      ORDER BY e.created_revision LIMIT $3`, [config.cursor_revision, revision, batchSize]);
    if (rows.length) {
      await client.query(`INSERT INTO notification_webhook_delivery(event_id,incident_id,generation,body)
        SELECT (body->>'eventId')::uuid,(body->>'incidentId')::uuid,$1,body FROM jsonb_array_elements($2::jsonb) AS entries(body)
        ON CONFLICT(event_id) DO NOTHING`, [config.generation, JSON.stringify(rows.map(webhookBody))]);
    }
    const cursor = rows.length === batchSize ? rows[rows.length - 1].created_revision : revision;
    await client.query("UPDATE notification_webhook SET cursor_revision=$1 WHERE id=1", [cursor]);
    return true;
  }, false, signal);
}

export async function deliverNextWebhook(signal: AbortSignal, send = postWebhook) {
  const db = getDatabase();
  const row = (await db.query(`WITH candidate AS (
    SELECT d.event_id,d.attempts FROM notification_webhook_delivery d JOIN notification_webhook w ON w.generation=d.generation AND w.active
    WHERE d.finished_at IS NULL AND d.due_at<=now() ORDER BY d.due_at,d.event_id LIMIT 1 FOR UPDATE OF d SKIP LOCKED
  ) UPDATE notification_webhook_delivery d SET lease=gen_random_uuid(),due_at=now()+interval '30 seconds',
    attempts=LEAST(d.attempts+1,5) FROM candidate WHERE candidate.event_id=d.event_id RETURNING d.*,candidate.attempts AS previous_attempts`)).rows[0];
  if (!row) return false;
  if (row.previous_attempts >= 5) {
    // The final attempt lost its receipt. Retrying here could exceed the delivery budget.
    const result = await db.query("UPDATE notification_webhook_delivery SET finished_at=now(),outcome='receipt_unknown',lease=NULL WHERE event_id=$1 AND lease=$2", [row.event_id, row.lease]);
    if (result.rowCount) console.error(JSON.stringify({ event: "notification_webhook_delivery_failed", eventId: row.event_id,
      incidentId: row.incident_id, generation: row.generation, attempt: row.attempts, reason: "receipt_unknown", retryMs: null }));
    return true;
  }
  const config = (await db.query("SELECT w.url,w.secret FROM notification_webhook w JOIN notification_webhook_delivery d ON d.generation=w.generation WHERE w.active AND d.event_id=$1 AND d.lease=$2 AND d.finished_at IS NULL", [row.event_id, row.lease])).rows[0];
  if (!config || signal.aborted) return false;

  const started = Date.now(), attempt = row.attempts;
  let outcome = "delivered", retry = false, status: number | null = null, retryAfter: string | undefined;
  try {
    const key = openProbeSecret(config.secret, webhookSecretContext);
    const response = await send(config.url, key, row.event_id, JSON.stringify(row.body), signal);
    status = response.status;
    if (status < 200 || status >= 300) {
      outcome = "http_error";
      retry = status === 408 || status === 429 || status >= 500;
      if (status === 429 || status === 503) retryAfter = response.retryAfter;
    }
  } catch (error) {
    if (signal.aborted) return false;
    const code = (error as NodeJS.ErrnoException)?.code;
    if (code === "probe_secret_unavailable") outcome = "invalid_key";
    else if (code === "EBLOCKED" || code === "invalid_request") outcome = "destination_blocked";
    else if (code && /CERT|TLS|SSL|ISSUER|SELF_SIGNED|SIGNATURE/.test(code)) outcome = "tls_error";
    else {
      retry = true;
      outcome = code === "ABORT_ERR" || code === "ETIMEDOUT" ? "timeout" : "network_error";
    }
  }
  const retryMs = retry && attempt < 5 ? webhookRetryMs(attempt, retryAfter) : null;
  const saved = await db.query(`UPDATE notification_webhook_delivery SET outcome=$3,lease=NULL,
    finished_at=CASE WHEN $4::int IS NULL THEN now() END,
    due_at=now()+coalesce($4::int,0)*interval '1 millisecond'
    WHERE event_id=$1 AND lease=$2 AND finished_at IS NULL`, [row.event_id, row.lease, outcome, retryMs]);
  if (saved.rowCount && outcome !== "delivered") console.error(JSON.stringify({
    event: "notification_webhook_delivery_failed", eventId: row.event_id, incidentId: row.incident_id,
    generation: row.generation, attempt, durationMs: Date.now() - started, status, reason: outcome, retryMs,
  }));
  return true;
}

export async function dispatchWebhooks(signal: AbortSignal) {
  while (!signal.aborted) {
    try {
      if (await enqueueWebhookEvents(signal) && await deliverNextWebhook(signal)) continue;
    } catch {
      if (!signal.aborted) console.error(JSON.stringify({ event: "notification_webhook_queue_unavailable" }));
    }
    await delay(5000, undefined, { signal }).catch(() => undefined);
  }
}
