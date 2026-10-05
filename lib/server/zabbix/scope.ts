import "server-only";
import { z } from "zod";
import { hostKeySchema } from "../../config/resources.ts";
import { getPrisma } from "../prisma.ts";
import { BffError } from "../bff.ts";
import { tag, type Item, type ZabbixHost } from "./types.ts";

export const monitoringScopeSchema = z.strictObject({
  hostKeys: z.array(hostKeySchema).min(1).max(500).refine(values => new Set(values).size === values.length),
  vmLinks: z.array(z.strictObject({ hostKey: hostKeySchema, parentHostKey: hostKeySchema, vmId: z.string().regex(/^(qemu|lxc)\/\d+$/) })).max(500).default([]),
}).refine(scope => scope.vmLinks.every(link => scope.hostKeys.includes(link.hostKey) && scope.hostKeys.includes(link.parentHostKey)) && new Set(scope.vmLinks.map(link => link.hostKey)).size === scope.vmLinks.length && new Set(scope.vmLinks.map(link => link.parentHostKey + ":" + link.vmId)).size === scope.vmLinks.length);
export type MonitoringScope = z.infer<typeof monitoringScopeSchema>;
export async function readScopeSettings() {
  try {
    const rows = await getPrisma().pulseSetting.findMany({ where: { key: { in: ["monitoringScope", "asgardHostKey"] } } });
    const scope = rows.find(row => row.key === "monitoringScope"), asgard = rows.find(row => row.key === "asgardHostKey");
    return { scope: scope ? monitoringScopeSchema.parse(scope.value) : null, asgardHostKey: asgard ? hostKeySchema.parse(asgard.value) : null };
  } catch { throw new BffError(503, "monitoring_scope_invalid"); }
}
export function selectScope(hosts: ZabbixHost[], configured: { scope: MonitoringScope | null; asgardHostKey: string | null }) {
  const explicit = configured.asgardHostKey;
  const candidates = hosts.filter(host => explicit ? host.host === explicit : host.host === "ASGARD" || tag(host.tags, "pulse.role") === "asgard");
  if (candidates.length !== 1) throw new BffError(503, "monitoring_scope_required");
  const asgard = candidates[0];
  const selected = configured.scope ? hosts.filter(host => configured.scope!.hostKeys.includes(host.host)) : hosts.filter(host => host === asgard || tag(host.tags, "pulse.parent") === asgard.host);
  if (!selected.includes(asgard) || (configured.scope && selected.length !== configured.scope.hostKeys.length)) throw new BffError(503, "monitoring_scope_unavailable");
  return { hosts: selected, asgardHostKey: asgard.host, vmLinks: configured.scope?.vmLinks ?? [] };
}
export function correlatedHost(parentHostKey: string, vmId: string, hosts: ZabbixHost[], links: MonitoringScope["vmLinks"]) {
  const matches = hosts.filter(host => links.some(link => link.parentHostKey === parentHostKey && link.vmId === vmId && link.hostKey === host.host) || (tag(host.tags, "pulse.parent") === parentHostKey && tag(host.tags, "pulse.vm") === vmId));
  return matches.length === 1 ? matches[0].host : null;
}
export function assertHypervisor(items: Item[], asgardHostId: string) {
  if (!items.some(item => item.hostid === asgardHostId && item.key_.startsWith("proxmox.node."))) throw new BffError(503, "asgard_capability_missing");
}
