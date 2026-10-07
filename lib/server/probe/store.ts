import "server-only";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { probeResultTtlSeconds, probeStripLength } from "../../config/external-services.ts";
import { isoSchema } from "../../monitoring/contracts.ts";
import { BffError } from "../bff.ts";
import { cacheOperation } from "../cache.ts";

export const probeKeys = { sync: "pulse:probe:sync", result: (id: string) => "pulse:probe:result:" + id };
export const probeResultKey = probeKeys.result;
const resultSchema = z.object({
  reason: z.number().int().min(0).max(7), latencyMs: z.number().int().nonnegative().nullable(), httpStatus: z.number().int().nullable(),
  certNotAfter: isoSchema.nullable(), uptime24h: z.object({ available: z.number().int().nonnegative(), total: z.number().int().nonnegative() }),
  strip: z.array(z.number().int().min(0).max(7)).max(probeStripLength),
});
const syncSchema = z.object({ status: z.enum(["ok", "failed"]), lastSuccessfulAt: isoSchema.nullable(), lastAttemptAt: isoSchema, error: z.string().max(80).nullable() });
const envelopeSchema = z.object({ data: z.unknown(), updatedAt: isoSchema, source: z.literal("probe"), generation: z.uuid() });
export type ProbeResult = z.infer<typeof resultSchema>;
type ProbeSync = z.infer<typeof syncSchema>;

async function readRaw(keys: string[]) {
  try {
    const values = await cacheOperation(client => client.mGet(keys));
    return values.map(value => value ? envelopeSchema.parse(JSON.parse(value)) : null);
  } catch (error) { if (error instanceof BffError) throw error; throw new BffError(503, "cache_unavailable"); }
}
export async function readProbeResults(ids: string[]) {
  const envelopes = ids.length ? await readRaw(ids.map(probeKeys.result)) : [];
  return new Map(ids.map((id, index) => {
    const parsed = envelopes[index] ? resultSchema.safeParse(envelopes[index].data) : null;
    return [id, parsed?.success ? { ...parsed.data, checkedAt: envelopes[index]!.updatedAt } : null];
  }));
}
export async function publishProbeResult(id: string, checkedAt: string, data: ProbeResult) {
  const payload = JSON.stringify({ data, updatedAt: isoSchema.parse(checkedAt), source: "probe", generation: randomUUID() });
  try { await cacheOperation(client => client.set(probeKeys.result(id), payload, { EX: probeResultTtlSeconds })); }
  catch { throw new BffError(503, "cache_unavailable"); }
}
export async function publishProbeSync(status: ProbeSync["status"], lastAttemptAt: string, error: string | null) {
  const current = (await readRaw([probeKeys.sync]).catch(() => [null]))[0];
  const previous = current ? syncSchema.safeParse(current.data).data : undefined;
  const data: ProbeSync = { status, lastSuccessfulAt: status === "ok" ? lastAttemptAt : previous?.lastSuccessfulAt ?? null, lastAttemptAt: isoSchema.parse(lastAttemptAt), error };
  const payload = JSON.stringify({ data, updatedAt: data.lastAttemptAt, source: "probe", generation: randomUUID() });
  try { await cacheOperation(client => client.set(probeKeys.sync, payload, { EX: probeResultTtlSeconds })); }
  catch { throw new BffError(503, "cache_unavailable"); }
}
