import { z } from "zod";
import { historyRangeSchema, hostKeySchema } from "../config/resources.ts";
import type { Host, History, ReadResult } from "../monitoring/contracts.ts";

export type WindowRange = History["window"];
export type HostsResult = ReadResult<Host[]> & { asgardHostKey?: string | null };
export const detailQuerySchema = z.object({ hostKey: hostKeySchema.optional(), vm: hostKeySchema.optional(), range: historyRangeSchema.default("24h") });
export function asgardUrl(hostKey: string, vmKey?: string, range: WindowRange = "24h") {
  return `/asgard?${new URLSearchParams({ hostKey, ...(vmKey ? { vm: vmKey } : {}), range })}`;
}
export function hostUrl(hostKey: string, range: WindowRange = "24h") {
  return `/hosts/${encodeURIComponent(hostKey)}?range=${range}`;
}
export function selectHypervisor(result: HostsResult, hostKey?: string) {
  const hosts = result.data.filter(host => host.role === "hypervisor");
  const key = hostKey ?? result.asgardHostKey;
  return key ? hosts.find(host => host.hostKey === key) : hosts.length === 1 ? hosts[0] : undefined;
}
export function evidenceExpired(item: Pick<Host, "evidence">, stale: boolean, now: number) {
  return stale || !item.evidence.observedAt || !!item.evidence.validUntil && Date.parse(item.evidence.validUntil) < now;
}
