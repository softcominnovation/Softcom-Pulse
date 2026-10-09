import "server-only";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { isoSchema } from "../../monitoring/contracts.ts";
import { BffError } from "../bff.ts";
import { cacheOperation } from "../cache.ts";
import { snapshotTiming } from "../cache/snapshots.ts";
import type { MonitorReading } from "./status.ts";

export const vpsResultKey = (id: string) => "pulse:vps:result:" + id;
const readingSchema = z.object({
  reason: z.number().int().min(0).max(5),
  latencyMs: z.number().int().nonnegative().nullable(),
  cpuPercent: z.number().nullable(),
  memoryPercent: z.number().nullable(),
  diskPercent: z.number().nullable(),
  cpu: z.object({ cores: z.number().int().nullable(), speed: z.string().nullable(), coresLoad: z.array(z.object({ core: z.string(), load: z.number().nullable() })) }),
  memory: z.object({ total: z.string().nullable(), used: z.string().nullable(), free: z.string().nullable() }),
  disks: z.array(z.object({ device: z.string().nullable(), type: z.string().nullable(), mount: z.string().nullable(), size: z.string().nullable(), used: z.string().nullable(), available: z.string().nullable(), use: z.number().nullable() })),
});
const envelopeSchema = z.object({ data: readingSchema, updatedAt: isoSchema, source: z.literal("vps"), generation: z.uuid() });
export type VpsResult = z.infer<typeof readingSchema> & { checkedAt: string };

export function vpsResultPayload(checkedAt: string, reason: number, latencyMs: number | null, reading: MonitorReading | null) {
  return {
    reason, latencyMs,
    cpuPercent: reading?.cpuPercent ?? null, memoryPercent: reading?.memoryPercent ?? null, diskPercent: reading?.diskPercent ?? null,
    cpu: reading?.cpu ?? { cores: null, speed: null, coresLoad: [] },
    memory: reading?.memory ?? { total: null, used: null, free: null },
    disks: reading?.disks ?? [],
    checkedAt,
  };
}
export async function publishVpsResult(id: string, checkedAt: string, reason: number, latencyMs: number | null, reading: MonitorReading | null) {
  const { checkedAt: publishedAt, ...data } = vpsResultPayload(checkedAt, reason, latencyMs, reading);
  void publishedAt;
  const payload = JSON.stringify({ data, updatedAt: isoSchema.parse(checkedAt), source: "vps", generation: randomUUID() });
  const ttl = snapshotTiming().ttl;
  await cacheOperation(client => client.set(vpsResultKey(id), payload, { EX: ttl }));
}
export async function readVpsResult(id: string): Promise<VpsResult | null> {
  try {
    const raw = await cacheOperation(client => client.get(vpsResultKey(id)));
    if (!raw) return null;
    const envelope = envelopeSchema.parse(JSON.parse(raw));
    return { ...envelope.data, checkedAt: envelope.updatedAt };
  } catch (error) { if (error instanceof BffError) throw error; return null; }
}
export async function deleteVpsResult(id: string) {
  await cacheOperation(client => client.del(vpsResultKey(id))).catch(() => undefined);
}
