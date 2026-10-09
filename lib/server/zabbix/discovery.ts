import "server-only";
import { z } from "zod";
import type { Host } from "../../monitoring/contracts.ts";
import { virtualizationType } from "../monitoring/virtual-machines.ts";
import { BffError } from "../bff.ts";
import { zabbixCall } from "./client.ts";
import { tag, zabbixHostSchema, type Rpc, type ZabbixHost } from "./types.ts";
import type { MonitoringScope } from "./scope.ts";

export const suggestedVmSchema = z.strictObject({
  parentHostKey: z.string().min(1),
  vmId: z.string().regex(/^(qemu|lxc)\/\d+$/),
  vmKey: z.string().min(1),
  vmName: z.string().min(1),
  match: z.enum(["exact_name", "tags"]),
});
export const agentCandidateSchema = z.strictObject({
  hostKey: z.string().min(1),
  displayName: z.string().min(1),
  agentAvailable: z.literal(true),
  suggestedVm: suggestedVmSchema.nullable(),
});
export const agentDiscoverySchema = z.strictObject({
  asgardHostKey: z.string().min(1),
  candidates: z.array(agentCandidateSchema).max(500),
});
export type AgentCandidate = z.infer<typeof agentCandidateSchema>;
export type AgentDiscovery = z.infer<typeof agentDiscoverySchema>;
export type SuggestedVm = z.infer<typeof suggestedVmSchema>;

/** How often the Collector runs the light host.get discovery. Default 3 (~60s with COLLECTOR_INTERVAL_MS=20000). */
export function discoveryEveryNCycles(value = process.env.PULSE_DISCOVERY_EVERY_N_CYCLES) {
  if (value == null || value === "") return 3;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1 || n > 30) return 3;
  return n;
}

const hostOutput = ["hostid", "host", "name", "status"];

function agentInterfaceReady(host: ZabbixHost) {
  const agents = host.interfaces.filter(item => item.type === "1");
  const main = agents.find(item => item.main === "1") ?? agents[0];
  return !!main && main.available === "1";
}

function fold(value: string) {
  return value.trim().toLocaleLowerCase("en-US");
}

function suggestVm(host: ZabbixHost, inventoryHosts: Host[]): SuggestedVm | null {
  const asgard = inventoryHosts.find(item => item.role === "hypervisor");
  if (!asgard) return null;
  const free = asgard.vms.filter(vm => !vm.linuxHostKey);

  const parent = tag(host.tags, "pulse.parent");
  const vmTag = tag(host.tags, "pulse.vm");
  if (parent && vmTag && /^(qemu|lxc)\/\d+$/.test(vmTag)) {
    const byTag = free.find(vm => vm.parentHostKey === parent && `${virtualizationType(vm)}/${vm.vmId}` === vmTag);
    if (byTag) {
      const type = virtualizationType(byTag);
      if (type && byTag.vmId) return { parentHostKey: byTag.parentHostKey, vmId: `${type}/${byTag.vmId}`, vmKey: byTag.vmKey, vmName: byTag.name, match: "tags" };
    }
  }

  const name = fold(host.host);
  const byName = free.filter(vm => fold(vm.name) === name);
  if (byName.length === 1) {
    const vm = byName[0];
    const type = virtualizationType(vm);
    if (type && vm.vmId) return { parentHostKey: vm.parentHostKey, vmId: `${type}/${vm.vmId}`, vmKey: vm.vmKey, vmName: vm.name, match: "exact_name" };
  }
  return null;
}

/** Pure classification used by unit tests and the Collector. */
export function classifyAgentCandidates(input: {
  hosts: ZabbixHost[];
  scopeHostKeys: string[];
  asgardHostKey: string;
  inventoryHosts: Host[];
}): AgentDiscovery {
  const inScope = new Set(input.scopeHostKeys);
  const candidates: AgentCandidate[] = [];
  for (const host of input.hosts) {
    if (host.status !== "0") continue;
    if (host.host === input.asgardHostKey) continue;
    if (inScope.has(host.host)) continue;
    if (!agentInterfaceReady(host)) continue;
    candidates.push({
      hostKey: host.host,
      displayName: host.name || host.host,
      agentAvailable: true,
      suggestedVm: suggestVm(host, input.inventoryHosts),
    });
  }
  candidates.sort((a, b) => a.hostKey.localeCompare(b.hostKey));
  return agentDiscoverySchema.parse({ asgardHostKey: input.asgardHostKey, candidates });
}

export async function discoverAgentCandidates(options: {
  rpc?: Rpc;
  scope: MonitoringScope;
  asgardHostKey: string;
  inventoryHosts: Host[];
  signal?: AbortSignal;
}): Promise<AgentDiscovery> {
  const rpc = options.rpc ?? zabbixCall;
  const rawHosts = z.array(zabbixHostSchema).parse(await rpc("host.get", {
    output: hostOutput,
    selectTags: ["tag", "value"],
    selectInterfaces: ["type", "main", "available"],
    limit: 501,
  }, options.signal));
  if (rawHosts.length > 500) throw new BffError(503, "discovery_too_large");
  return classifyAgentCandidates({
    hosts: rawHosts,
    scopeHostKeys: options.scope.hostKeys,
    asgardHostKey: options.asgardHostKey,
    inventoryHosts: options.inventoryHosts,
  });
}
