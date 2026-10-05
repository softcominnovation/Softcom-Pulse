import "server-only";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { isoSchema, type ReadResult } from "../../monitoring/contracts.ts";
import { BffError } from "../bff.ts";
import { cacheOperation } from "../cache.ts";

export const snapshotKeys = {
  overview: "pulse:snapshot:overview", hosts: "pulse:inventory:hosts", problems: "pulse:problems:current", sync: "pulse:sync:last",
  bindings: "pulse:source:bindings",
  containers: (hostKey: string) => "pulse:inventory:containers:" + encodeURIComponent(hostKey),
  host: (hostKey: string) => "pulse:snapshot:host:" + encodeURIComponent(hostKey),
  service: (id: string) => "pulse:snapshot:service:" + id,
};
const keySchema = z.string().max(2048).refine(key => /^pulse:(?:snapshot:(?:overview|host:.+|service:.+)|inventory:(?:hosts|containers:.+)|problems:current|source:bindings)$/.test(key));
const envelopeSchema = z.object({ data: z.unknown(), updatedAt: isoSchema, source: z.literal("zabbix"), generation: z.uuid() });
const syncSchema = z.object({ status: z.enum(["ok", "failed"]), lastSuccessfulAt: isoSchema.nullable(), lastAttemptAt: isoSchema.optional(), error: z.string().max(80).nullable().optional(), keys: z.array(keySchema).max(50000) });
export type SnapshotEnvelope = z.infer<typeof envelopeSchema>;
export type SnapshotBatch = { snapshots: Map<string, SnapshotEnvelope | null>; sync: z.infer<typeof syncSchema> | null; generation: string | null };

export function snapshotTiming() {
  const parse = (key: string, fallback: number) => {
    const value = Number(process.env[key] ?? fallback);
    if (!Number.isSafeInteger(value) || value <= 0) throw new BffError(503, "snapshot_configuration_invalid");
    return value;
  };
  const interval = parse("COLLECTOR_INTERVAL_MS", 20000), ttl = parse("SNAPSHOT_TTL_SECONDS", 300), staleAfter = parse("SNAPSHOT_STALE_AFTER_MS", 60000);
  if (interval < 15000 || interval > 30000 || ttl > 2147483647 || staleAfter < interval * 2 || staleAfter >= ttl * 1000) throw new BffError(503, "snapshot_configuration_invalid");
  return { interval, ttl, staleAfter };
}
export async function readSnapshotBatch(keys: string[]): Promise<SnapshotBatch> {
  snapshotTiming();
  const unique = [...new Set(keys)];
  unique.forEach(key => keySchema.parse(key));
  try {
    const values = await cacheOperation(client => client.mGet([...unique, snapshotKeys.sync]));
    const rawSync = values.pop();
    const syncEnvelope = rawSync ? envelopeSchema.parse(JSON.parse(rawSync)) : null;
    const sync = syncEnvelope ? syncSchema.parse(syncEnvelope.data) : null;
    const active = new Set(sync?.keys ?? []);
    const snapshots = new Map<string, SnapshotEnvelope | null>();
    for (let i = 0; i < unique.length; i++) {
      const value = active.has(unique[i]) && values[i] ? envelopeSchema.parse(JSON.parse(values[i]!)) : null;
      if (value && value.generation !== syncEnvelope?.generation) throw new BffError(503, "snapshot_inconsistent");
      snapshots.set(unique[i], value);
    }
    return { snapshots, sync, generation: syncEnvelope?.generation ?? null };
  } catch (error) {
    if (error instanceof BffError) throw error;
    throw new BffError(503, "cache_unavailable");
  }
}

export async function publishSnapshots(entries: Record<string, unknown>, updatedAt = new Date().toISOString(), lastAttemptAt = updatedAt) {
  const { ttl } = snapshotTiming();
  isoSchema.parse(updatedAt);
  const keys = Object.keys(entries);
  keys.forEach(key => keySchema.parse(key));
  const generation = randomUUID();
  const wrap = (data: unknown) => JSON.stringify({ data, updatedAt, source: "zabbix", generation });
  try {
    await cacheOperation(client => {
      const tx = client.multi();
      for (const [key, value] of Object.entries(entries)) tx.set(key, wrap(value), { EX: ttl });
      tx.set(snapshotKeys.sync, wrap({ status: "ok", lastSuccessfulAt: updatedAt, lastAttemptAt: isoSchema.parse(lastAttemptAt), error: null, keys }), { EX: ttl });
      return tx.exec();
    });
  } catch { throw new BffError(503, "cache_unavailable"); }
  return generation;
}

export function readResult<T>(data: T, batch: SnapshotBatch, keys: string[], now = Date.now()): ReadResult<T> {
  const { interval, staleAfter } = snapshotTiming();
  const snapshots = keys.flatMap(key => batch.snapshots.get(key) ?? []);
  const lastUpdated = snapshots.length ? snapshots.map(item => item.updatedAt).sort()[0] : batch.sync?.lastSuccessfulAt ?? null;
  const stale = batch.sync?.status === "failed" || (lastUpdated !== null && now - Date.parse(lastUpdated) > staleAfter);
  return { data, availability: snapshots.length ? "ready" : "no_data", stale, lastUpdated, refreshAfterMs: interval };
}

export async function markSyncFailure(errorCode = "collection_failed", lastAttemptAt = new Date().toISOString()) {
  const { ttl } = snapshotTiming();
  isoSchema.parse(lastAttemptAt);
  const error = /^[a-z_]{1,80}$/.test(errorCode) ? errorCode : "collection_failed";
  const fallback = JSON.stringify({ data: { status: "failed", lastSuccessfulAt: null, lastAttemptAt, error, keys: [] }, updatedAt: lastAttemptAt, source: "zabbix", generation: randomUUID() });
  try {
    await cacheOperation(client => client.eval(
      "local raw=redis.call('GET',KEYS[1]); if raw then local v=cjson.decode(raw); v.data.status='failed'; v.data.lastAttemptAt=ARGV[3]; v.data.error=ARGV[4]; redis.call('SET',KEYS[1],cjson.encode(v),'KEEPTTL'); else redis.call('SET',KEYS[1],ARGV[1],'EX',ARGV[2]); end; return 1",
      { keys: [snapshotKeys.sync], arguments: [fallback, String(ttl), lastAttemptAt, error] },
    ));
  } catch { throw new BffError(503, "cache_unavailable"); }
}

export function snapshotData<T>(batch: SnapshotBatch, key: string, schema: z.ZodType<T>, fallback: T): T {
  const envelope = batch.snapshots.get(key);
  if (!envelope) return fallback;
  const result = schema.safeParse(envelope.data);
  if (!result.success) throw new BffError(503, "snapshot_invalid");
  return result.data;
}
