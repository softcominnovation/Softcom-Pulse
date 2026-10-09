import "server-only";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { isoSchema } from "../../monitoring/contracts.ts";
import { BffError } from "../bff.ts";
import { cacheOperation } from "../cache.ts";
import { agentDiscoverySchema, type AgentDiscovery } from "../zabbix/discovery.ts";
import { snapshotTiming } from "./snapshots.ts";

export const discoveryKey = "pulse:discovery:agent-candidates";
const envelopeSchema = z.object({ data: agentDiscoverySchema, updatedAt: isoSchema, source: z.literal("zabbix"), generation: z.uuid() });

export async function publishAgentDiscovery(data: AgentDiscovery, updatedAt = new Date().toISOString()) {
  const { ttl } = snapshotTiming();
  isoSchema.parse(updatedAt);
  const payload = JSON.stringify({ data: agentDiscoverySchema.parse(data), updatedAt, source: "zabbix", generation: randomUUID() });
  try {
    await cacheOperation(client => client.set(discoveryKey, payload, { EX: ttl }));
  } catch { throw new BffError(503, "cache_unavailable"); }
}

export async function readAgentDiscovery(now = Date.now()): Promise<{
  data: AgentDiscovery | null;
  discoveryStatus: "ready" | "stale" | "unavailable" | "no_data";
  updatedAt: string | null;
}> {
  const { staleAfter } = snapshotTiming();
  try {
    const raw = await cacheOperation(client => client.get(discoveryKey));
    if (!raw) return { data: null, discoveryStatus: "no_data", updatedAt: null };
    const envelope = envelopeSchema.parse(JSON.parse(raw));
    const stale = now - Date.parse(envelope.updatedAt) > staleAfter;
    return { data: envelope.data, discoveryStatus: stale ? "stale" : "ready", updatedAt: envelope.updatedAt };
  } catch (error) {
    if (error instanceof BffError) throw error;
    return { data: null, discoveryStatus: "unavailable", updatedAt: null };
  }
}
