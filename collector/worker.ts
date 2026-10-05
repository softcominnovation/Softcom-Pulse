import "server-only";
import { setTimeout as delay } from "node:timers/promises";
import { collectSnapshots } from "../lib/server/zabbix/collect.ts";
import { publishSnapshots, markSyncFailure, snapshotTiming } from "../lib/server/cache/snapshots.ts";
import { getDatabase } from "../lib/server/database.ts";
import { getCache } from "../lib/server/cache.ts";
import { getPrisma } from "../lib/server/prisma.ts";
import { zabbixCall } from "../lib/server/zabbix/client.ts";
import { BffError } from "../lib/server/bff.ts";

export function createCycle(dependencies = { collect: collectSnapshots, publish: publishSnapshots, fail: markSyncFailure }) {
  let active: Promise<boolean> | null = null;
  return (signal?: AbortSignal): Promise<boolean> => {
    if (active) return active;
    const lastAttemptAt = new Date().toISOString();
    active = (async () => {
      try {
        const { entries } = await dependencies.collect({ signal });
        if (signal?.aborted) return false;
        await dependencies.publish(entries, new Date().toISOString(), lastAttemptAt);
        return true;
      } catch (error) {
        const code = error instanceof BffError ? error.code : "collection_failed";
        await dependencies.fail(code, lastAttemptAt).catch(() => {});
        return false;
      } finally { active = null; }
    })();
    return active;
  };
}
export async function runCollector(once = false) {
  const { interval } = snapshotTiming(), shutdown = new AbortController();
  const stop = () => shutdown.abort();
  process.once("SIGTERM", stop); process.once("SIGINT", stop);
  const pool = getDatabase();
  const lease = await pool.connect();
  lease.on("error", stop);
  let locked = false;
  try {
    locked = (await lease.query("SELECT pg_try_advisory_lock(734021004::bigint) AS locked")).rows[0].locked;
    if (!locked) throw new BffError(503, "collector_already_running");
    const version = await zabbixCall<string>("apiinfo.version", {}, shutdown.signal);
    if (!/^7\.0\.\d+$/.test(version)) throw new BffError(503, "zabbix_version_unsupported");
    console.log(JSON.stringify({ event: "collector_started", zabbixVersion: version }));
    const cycle = createCycle();
    do {
      const started = Date.now();
      await lease.query("SELECT 1");
      const success = await cycle(AbortSignal.any([shutdown.signal, AbortSignal.timeout(25000)]));
      console.log(JSON.stringify({ event: "collector_cycle", success, durationMs: Date.now() - started }));
      if (once) { if (!success) process.exitCode = 1; break; }
      if (!shutdown.signal.aborted) await delay(Math.max(0, interval - (Date.now() - started)), undefined, { signal: shutdown.signal }).catch(() => {});
    } while (!shutdown.signal.aborted);
  } catch (error) {
    const code = error instanceof BffError ? error.code : "collector_failed";
    if (code !== "collector_already_running") await markSyncFailure(code).catch(() => {});
    console.error(JSON.stringify({ event: "collector_stopped", error: code }));
    process.exitCode = 1;
  } finally {
    process.removeListener("SIGTERM", stop); process.removeListener("SIGINT", stop);
    if (locked) await lease.query("SELECT pg_advisory_unlock(734021004::bigint)").catch(() => {});
    lease.release();
    const cache = await getCache().catch(() => null);
    if (cache?.isOpen) cache.destroy();
    await getPrisma().$disconnect();
    await pool.end();
  }
}
