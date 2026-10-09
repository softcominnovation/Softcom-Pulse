import "server-only";
import { z } from "zod";
import { hostSchema } from "../../monitoring/contracts.ts";
import { BffError } from "../bff.ts";
import { readAgentDiscovery } from "../cache/discovery.ts";
import { readSnapshotBatch, readResult, snapshotData, snapshotKeys } from "../cache/snapshots.ts";
import { virtualizationType } from "../monitoring/virtual-machines.ts";
import {
  linkAgentToScope, unlinkAgentFromScope, readScopeSettings, ensureBootstrapMonitoringScope,
  scopeLinkBodySchema, scopeUnlinkBodySchema,
} from "../zabbix/scope.ts";

function sanitizeScope(asgardHostKey: string, scope: NonNullable<Awaited<ReturnType<typeof readScopeSettings>>["scope"]>) {
  return {
    asgardHostKey,
    revision: scope.revision,
    hostKeys: scope.hostKeys,
    vmLinks: scope.vmLinks,
  };
}

export async function readMonitoringScopeDocument() {
  let settings = await readScopeSettings();
  if (!settings.scope || !settings.asgardHostKey) {
    const bootstrapped = await ensureBootstrapMonitoringScope();
    settings = { scope: bootstrapped.scope, asgardHostKey: bootstrapped.asgardHostKey };
  }
  if (!settings.scope || !settings.asgardHostKey) throw new BffError(503, "monitoring_scope_required");
  const discovery = await readAgentDiscovery();
  const batch = await readSnapshotBatch([snapshotKeys.hosts]);
  const hosts = snapshotData(batch, snapshotKeys.hosts, z.array(hostSchema), []);
  const asgard = hosts.find(host => host.hostKey === settings.asgardHostKey && host.role === "hypervisor");
  const scoped = settings.scope.hostKeys.map(hostKey => {
    const link = settings.scope!.vmLinks.find(item => item.hostKey === hostKey);
    const host = hosts.find(item => item.hostKey === hostKey);
    return {
      hostKey,
      displayName: host?.displayName ?? host?.name ?? hostKey,
      role: hostKey === settings.asgardHostKey ? "hypervisor" as const : "agent" as const,
      linkedVm: link ? {
        parentHostKey: link.parentHostKey,
        vmId: link.vmId,
        vmName: asgard?.vms.find(vm => `${virtualizationType(vm)}/${vm.vmId}` === link.vmId)?.name ?? link.vmId,
      } : null,
    };
  });
  const unlinkedVms = (asgard?.vms ?? [])
    .filter(vm => !vm.linuxHostKey && virtualizationType(vm) && vm.vmId)
    .map(vm => ({
      parentHostKey: vm.parentHostKey,
      vmId: `${virtualizationType(vm)}/${vm.vmId}`,
      vmKey: vm.vmKey,
      vmName: vm.displayName ?? vm.name,
    }));
  const hostsResult = readResult(hosts, batch, [snapshotKeys.hosts]);
  return {
    data: {
      ...sanitizeScope(settings.asgardHostKey, settings.scope),
      hosts: scoped,
      candidates: (discovery.data?.candidates ?? []).filter(item => !settings.scope!.hostKeys.includes(item.hostKey)),
      unlinkedVms,
      discoveryStatus: discovery.discoveryStatus,
      discoveryUpdatedAt: discovery.updatedAt,
    },
    availability: hostsResult.availability === "ready" || discovery.discoveryStatus === "ready" ? "ready" as const : hostsResult.availability,
    stale: hostsResult.stale || discovery.discoveryStatus === "stale",
    lastUpdated: [hostsResult.lastUpdated, discovery.updatedAt].filter(Boolean).sort().at(-1) ?? null,
    refreshAfterMs: hostsResult.refreshAfterMs,
  };
}

export async function postMonitoringScopeLink(body: unknown) {
  const input = scopeLinkBodySchema.parse(body);
  let settings = await readScopeSettings();
  if (!settings.scope || !settings.asgardHostKey) {
    const bootstrapped = await ensureBootstrapMonitoringScope(input.parentHostKey);
    settings = { scope: bootstrapped.scope, asgardHostKey: bootstrapped.asgardHostKey };
  }
  if (!settings.scope || !settings.asgardHostKey) throw new BffError(503, "monitoring_scope_required");
  const discovery = await readAgentDiscovery();
  const allowed = new Set([
    ...settings.scope.hostKeys,
    ...(discovery.data?.candidates.map(item => item.hostKey) ?? []),
  ]);
  const batch = await readSnapshotBatch([snapshotKeys.hosts]);
  const hosts = snapshotData(batch, snapshotKeys.hosts, z.array(hostSchema), []);
  const asgard = hosts.find(host => host.hostKey === input.parentHostKey && host.role === "hypervisor");
  const vm = asgard?.vms.find(item => `${virtualizationType(item)}/${item.vmId}` === input.vmId);
  if (!vm) throw new BffError(400, "invalid_request");
  if (vm.linuxHostKey && vm.linuxHostKey !== input.hostKey) throw new BffError(400, "invalid_request");
  const saved = await linkAgentToScope(input, allowed);
  return { data: sanitizeScope(saved.asgardHostKey, saved.scope) };
}

export async function deleteMonitoringScopeLink(body: unknown) {
  const saved = await unlinkAgentFromScope(scopeUnlinkBodySchema.parse(body));
  return { data: sanitizeScope(saved.asgardHostKey, saved.scope) };
}
