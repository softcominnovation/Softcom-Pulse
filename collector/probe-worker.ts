import "server-only";
import { setTimeout as delay } from "node:timers/promises";
import { probeIntervalMs } from "../lib/config/external-services.ts";
import { runProbeCycle, runProbeMaintenance } from "../lib/server/probe/cycle.ts";
import { publishProbeSync } from "../lib/server/probe/store.ts";
import { getDatabase } from "../lib/server/database.ts";
import { getCache } from "../lib/server/cache.ts";
import { getPrisma } from "../lib/server/prisma.ts";
import { BffError } from "../lib/server/bff.ts";

export function createProbeCycle(run = runProbeCycle) {
  let active: Promise<boolean> | null = null;
  return (signal?: AbortSignal): Promise<boolean> => {
    if (active) return active;
    const lastAttemptAt = new Date().toISOString();
    active = (async () => {
      try {
        await run({ signal });
        if (!signal?.aborted) await publishProbeSync("ok", new Date().toISOString(), null);
        return true;
      } catch (error) {
        const code = error instanceof BffError ? error.code : "probe_collection_failed";
        await publishProbeSync("failed", lastAttemptAt, code).catch(() => undefined);
        return false;
      } finally { active = null; }
    })();
    return active;
  };
}
export async function runProbe(once = false) {
  if (probeIntervalMs() === null) {
    console.error(JSON.stringify({ event: "probe_stopped", error: "probe_configuration_invalid" }));
    process.exitCode = 1;
    return;
  }
  const interval = probeIntervalMs()!, shutdown = new AbortController();
  const stop = () => shutdown.abort();
  process.once("SIGTERM", stop); process.once("SIGINT", stop);
  const pool = getDatabase();
  const lease = await pool.connect();
  lease.on("error", stop);
  let locked = false, lastPurge = 0;
  try {
    locked = (await lease.query("SELECT pg_try_advisory_lock(734021007::bigint) AS locked")).rows[0].locked; // 734021005 stays with template writes
    if (!locked) throw new BffError(503, "probe_already_running");
    console.log(JSON.stringify({ event: "probe_started", intervalMs: interval }));
    const cycle = createProbeCycle();
    do {
      const started = Date.now();
      await lease.query("SELECT 1");
      const success = await cycle(shutdown.signal);
      lastPurge = await runProbeMaintenance(shutdown.signal, lastPurge).catch(() => lastPurge);
      console.log(JSON.stringify({ event: "probe_cycle", success, durationMs: Date.now() - started }));
      if (once) { if (!success) process.exitCode = 1; break; }
      if (!shutdown.signal.aborted) await delay(Math.max(0, interval - (Date.now() - started)), undefined, { signal: shutdown.signal }).catch(() => undefined);
    } while (!shutdown.signal.aborted);
  } catch (error) {
    const code = error instanceof BffError ? error.code : "probe_failed";
    if (code !== "probe_already_running") await publishProbeSync("failed", new Date().toISOString(), code).catch(() => undefined);
    console.error(JSON.stringify({ event: "probe_stopped", error: code }));
    process.exitCode = 1;
  } finally {
    process.removeListener("SIGTERM", stop); process.removeListener("SIGINT", stop);
    if (locked) await lease.query("SELECT pg_advisory_unlock(734021007::bigint)").catch(() => undefined);
    lease.release();
    const cache = await getCache().catch(() => null);
    if (cache?.isOpen) cache.destroy();
    await getPrisma().$disconnect();
    await pool.end();
  }
}
