import "server-only";
import { setTimeout as delay } from "node:timers/promises";
import { signalHealthLivePath, signalHealthReadyPath, signalMonitorConfigurationOk, signalMonitorIntervalMs } from "../lib/config/signal-targets.ts";
import { runSignalMonitorCycle } from "../lib/server/signal/cycle.ts";
import { getDatabase } from "../lib/server/database.ts";
import { getCache } from "../lib/server/cache.ts";
import { getPrisma } from "../lib/server/prisma.ts";
import { BffError } from "../lib/server/bff.ts";

export function createSignalMonitorCycle(run = runSignalMonitorCycle) {
  let active: Promise<boolean> | null = null;
  return (signal?: AbortSignal): Promise<boolean> => {
    if (active) return active;
    active = (async () => {
      try { await run({ signal }); return !signal?.aborted; }
      catch { return false; }
      finally { active = null; }
    })();
    return active;
  };
}

export async function runSignalMonitor(once = false) {
  if (!signalMonitorConfigurationOk()) {
    console.error(JSON.stringify({ event: "signal_monitor_stopped", error: "signal_monitor_configuration_invalid" }));
    process.exitCode = 1;
    return;
  }
  const interval = signalMonitorIntervalMs()!;
  const shutdown = new AbortController();
  const stop = () => shutdown.abort();
  process.once("SIGTERM", stop); process.once("SIGINT", stop);
  const pool = getDatabase();
  const lease = await pool.connect();
  lease.on("error", stop);
  let locked = false;
  try {
    locked = (await lease.query("SELECT pg_try_advisory_lock(734021011::bigint) AS locked")).rows[0].locked;
    if (!locked) throw new BffError(503, "signal_monitor_already_running");
    console.log(JSON.stringify({
      event: "signal_monitor_started",
      intervalMs: interval,
      livePath: signalHealthLivePath(),
      readyPath: signalHealthReadyPath(),
    }));
    const cycle = createSignalMonitorCycle();
    do {
      const started = Date.now();
      await lease.query("SELECT 1");
      const success = await cycle(shutdown.signal);
      console.log(JSON.stringify({ event: "signal_monitor_cycle", success, durationMs: Date.now() - started }));
      if (once) { if (!success) process.exitCode = 1; break; }
      if (!shutdown.signal.aborted) await delay(Math.max(0, interval - (Date.now() - started)), undefined, { signal: shutdown.signal }).catch(() => undefined);
    } while (!shutdown.signal.aborted);
  } catch (error) {
    const code = error instanceof BffError ? error.code : "signal_monitor_failed";
    console.error(JSON.stringify({ event: "signal_monitor_stopped", error: code }));
    process.exitCode = 1;
  } finally {
    process.removeListener("SIGTERM", stop); process.removeListener("SIGINT", stop);
    if (locked) await lease.query("SELECT pg_advisory_unlock(734021011::bigint)").catch(() => undefined);
    lease.release();
    const cache = await getCache().catch(() => null);
    if (cache?.isOpen) cache.destroy();
    await getPrisma().$disconnect();
    await pool.end();
  }
}
