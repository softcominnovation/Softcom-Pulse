import "server-only";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { signalResultTtlSeconds, signalStripLength } from "../../config/signal-targets.ts";
import { isoSchema } from "../../monitoring/contracts.ts";
import { BffError } from "../bff.ts";
import { cacheOperation } from "../cache.ts";

export const signalKeys = { sync: "pulse:signal:sync", result: (id: string) => "pulse:signal:result:" + id };
export const signalResultKey = signalKeys.result;

const resultSchema = z.object({
  state: z.number().int().min(0).max(4),
  latencyMs: z.number().int().nonnegative().nullable(),
  httpStatus: z.number().int().nullable(),
  liveOk: z.boolean().nullable(),
  readyStatus: z.enum(["ok", "degraded", "unknown"]).nullable(),
  workerStatus: z.string().max(32).nullable(),
  activeInstances: z.number().int().nullable(),
  outboxPending: z.number().int().nullable(),
  inboxPending: z.number().int().nullable(),
  outboxDead: z.number().int().nullable(),
  inboxDead: z.number().int().nullable(),
  oldestOutboxSeconds: z.number().nullable(),
  oldestInboxSeconds: z.number().nullable(),
  checks: z.record(z.string(), z.unknown()).nullable(),
  strip: z.array(z.number().int().min(0).max(4)).max(signalStripLength),
  uptime24h: z.object({ available: z.number().int().nonnegative(), total: z.number().int().nonnegative() }).nullable(),
});
const syncSchema = z.object({
  status: z.enum(["ok", "failed"]),
  lastSuccessfulAt: isoSchema.nullable(),
  lastAttemptAt: isoSchema,
  error: z.string().max(80).nullable(),
});
const envelopeSchema = z.object({ data: z.unknown(), updatedAt: isoSchema, source: z.literal("signal-monitor"), generation: z.uuid() });
export type SignalResult = z.infer<typeof resultSchema>;

async function readRaw(keys: string[]) {
  try {
    const values = await cacheOperation(client => client.mGet(keys));
    return values.map(value => value ? envelopeSchema.parse(JSON.parse(value)) : null);
  } catch (error) { if (error instanceof BffError) throw error; throw new BffError(503, "cache_unavailable"); }
}

export async function readSignalResults(ids: string[]) {
  const envelopes = ids.length ? await readRaw(ids.map(signalKeys.result)) : [];
  return new Map(ids.map((id, index) => {
    const parsed = envelopes[index] ? resultSchema.safeParse(envelopes[index].data) : null;
    return [id, parsed?.success ? { ...parsed.data, checkedAt: envelopes[index]!.updatedAt } : null];
  }));
}

export async function publishSignalResult(id: string, checkedAt: string, data: SignalResult) {
  const payload = JSON.stringify({ data, updatedAt: isoSchema.parse(checkedAt), source: "signal-monitor", generation: randomUUID() });
  try { await cacheOperation(client => client.set(signalKeys.result(id), payload, { EX: signalResultTtlSeconds })); }
  catch { throw new BffError(503, "cache_unavailable"); }
}

export async function publishSignalSync(status: "ok" | "failed", lastAttemptAt: string, error: string | null) {
  const current = (await readRaw([signalKeys.sync]).catch(() => [null]))[0];
  const previous = current ? syncSchema.safeParse(current.data).data : undefined;
  const data = {
    status,
    lastSuccessfulAt: status === "ok" ? lastAttemptAt : previous?.lastSuccessfulAt ?? null,
    lastAttemptAt: isoSchema.parse(lastAttemptAt),
    error,
  };
  const payload = JSON.stringify({ data, updatedAt: data.lastAttemptAt, source: "signal-monitor", generation: randomUUID() });
  try { await cacheOperation(client => client.set(signalKeys.sync, payload, { EX: signalResultTtlSeconds })); }
  catch { throw new BffError(503, "cache_unavailable"); }
}

export async function deleteSignalResult(id: string) {
  try { await cacheOperation(client => client.del(signalKeys.result(id))); }
  catch { throw new BffError(503, "cache_unavailable"); }
}
