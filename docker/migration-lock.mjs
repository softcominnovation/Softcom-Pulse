import pg from "pg";
import { setTimeout as delay } from "node:timers/promises";

const LOCK_KEY = "734021001";

export async function withMigrationLock({ connectionString, execute, waitMs = 120000, connectMs = 3000, signal, onLocked }) {
  if (!connectionString) throw new Error("Database configuration is missing.");
  const deadline = Date.now() + waitMs;
  let client;
  while (!client) {
    signal?.throwIfAborted();
    const attempt = new pg.Client({ connectionString, connectionTimeoutMillis: Math.min(connectMs, Math.max(1, deadline - Date.now())), query_timeout: 5000 });
    attempt.on("error", () => {});
    try { await attempt.connect(); client = attempt; }
    catch {
      await attempt.end().catch(() => {});
      if (Date.now() >= deadline) throw new Error("Database connection timed out.");
      await delay(Math.min(500, deadline - Date.now()), undefined, { signal });
    }
  }

  const controller = new AbortController();
  let acquired = false;
  let lost = false;
  let rejectFailure;
  const failure = new Promise((_, reject) => { rejectFailure = reject; });
  failure.catch(() => {});
  const abort = () => { controller.abort(); rejectFailure(new Error("Migration interrupted.")); };
  const connectionLost = () => { lost = true; controller.abort(); rejectFailure(new Error("Migration lock connection was lost.")); };
  client.on("error", connectionLost);
  client.on("end", connectionLost);
  signal?.addEventListener("abort", abort, { once: true });
  let execution;

  try {
    while (!acquired) {
      signal?.throwIfAborted();
      if (lost) throw new Error("Migration lock connection was lost.");
      const result = await client.query("SELECT pg_try_advisory_lock($1::bigint) AS locked", [LOCK_KEY]);
      acquired = result.rows[0].locked;
      if (!acquired) {
        if (Date.now() >= deadline) throw new Error("Migration lock timed out.");
        await Promise.race([delay(200, undefined, { signal }), failure]);
      }
    }
    await onLocked?.(client);
    // The dedicated session owns the lock until the migration subprocess has exited.
    execution = Promise.resolve().then(() => execute(controller.signal));
    await Promise.race([execution, failure]);
    if (lost || controller.signal.aborted) throw new Error("Migration lock was not retained.");
  } catch (error) {
    controller.abort();
    await execution?.catch(() => {});
    throw error;
  } finally {
    signal?.removeEventListener("abort", abort);
    if (acquired && !lost) await client.query("SELECT pg_advisory_unlock($1::bigint)", [LOCK_KEY]).catch(() => { lost = true; });
    client.removeListener("end", connectionLost);
    await client.end().catch(() => {});
    client.removeListener("error", connectionLost);
  }
  if (lost || controller.signal.aborted) throw new Error("Migration lock was not retained through completion.");
}
