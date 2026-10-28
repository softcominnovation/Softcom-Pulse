import "server-only";
import type { PoolClient } from "pg";
import { getDatabase } from "../database.ts";
import { BffError } from "../bff.ts";
import { defaultNotificationPolicy, notificationPolicySchema } from "../../notifications/policy.ts";

export async function notificationTransaction<T>(action: (client: PoolClient) => Promise<T>, readOnly = false, signal?: AbortSignal): Promise<T> {
  if (signal?.aborted) throw new BffError(503, "notifications_unavailable");
  const pending = getDatabase().connect();
  let abortAcquire: (() => void) | undefined;
  const cancelled = new Promise<never>((_, reject) => {
    abortAcquire = () => reject(new BffError(503, "notifications_unavailable"));
    signal?.addEventListener("abort", abortAcquire, { once: true });
  });
  const client = await Promise.race([pending, cancelled]).catch(() => {
    void pending.then(client => client.release(true)).catch(() => undefined);
    throw new BffError(503, "notifications_unavailable");
  }).finally(() => { if (abortAcquire) signal?.removeEventListener("abort", abortAcquire); });
  let released = false;
  const cancel = () => { if (!released) { released = true; client.release(true); } };
  signal?.addEventListener("abort", cancel, { once: true });
  try {
    if (signal?.aborted) { cancel(); throw new BffError(503, "notifications_unavailable"); }
    await client.query(readOnly ? "BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY" : "BEGIN");
    await client.query("SET LOCAL lock_timeout='1500ms'");
    const result = await action(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    if (!released) await client.query("ROLLBACK").catch(() => undefined);
    if (error instanceof BffError) throw error;
    const unavailable = new BffError(503, "notifications_unavailable");
    unavailable.cause = error;
    throw unavailable;
  } finally { signal?.removeEventListener("abort", cancel); if (!released) client.release(); }
}
export async function readPolicy(client: PoolClient, lock = false) {
  const { rows } = await client.query("SELECT value FROM pulse_settings WHERE key='notifications'" + (lock ? " FOR SHARE" : ""));
  if (!rows.length) return defaultNotificationPolicy();
  const parsed = notificationPolicySchema.safeParse(rows[0].value);
  if (!parsed.success) throw new BffError(503, "notifications_unavailable");
  return parsed.data;
}
export type Stream = { revision: string; delivery_revision: string; generation: string; minimum_revision: string };
export async function readStream(client: PoolClient) {
  const { rows } = await client.query<Stream>("SELECT revision,delivery_revision,generation,minimum_revision FROM notification_stream_state WHERE id=1");
  if (!rows[0]) throw new BffError(503, "notifications_unavailable");
  return rows[0];
}
export async function appendChange(client: PoolClient, kind: string, payload: object, policyChanged = false) {
  const { rows } = await client.query<{ revision: string }>("UPDATE notification_stream_state SET revision=revision+1,delivery_revision=delivery_revision+$1 WHERE id=1 RETURNING revision", [policyChanged ? 1 : 0]);
  const revision = rows[0].revision;
  await client.query("INSERT INTO notification_change(revision,kind,payload) VALUES($1,$2,$3)", [revision, kind, JSON.stringify(payload)]);
  return revision;
}
