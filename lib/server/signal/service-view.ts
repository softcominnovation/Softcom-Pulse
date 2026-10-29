import "server-only";
import { z } from "zod";
import { hostKeySchema } from "../../config/resources.ts";
import { containerSchema, hostSchema, isoSchema, type Container, type Host } from "../../monitoring/contracts.ts";
import { resolveSignalService, type ServiceHostCoverage, type ServiceObservedContainer, type ServiceScopeHost, type ServiceScopeLink, type ServiceScopeVm, type SignalServiceResolution } from "../../signal/service-resolver.ts";
import { readSnapshotBatch, snapshotData, snapshotKeys } from "../cache/snapshots.ts";

export const dockerCoverageSchema = z.object({
  hosts: z.array(z.object({
    hostKey: hostKeySchema,
    complete: z.boolean(),
    names: z.array(z.string().max(512)).max(5000),
    observedAt: isoSchema.nullable(),
    validUntil: isoSchema.nullable(),
    reason: z.string().max(80).nullable(),
    disabled: z.boolean().default(false),
  })).max(500),
});

export type SignalServiceRow = {
  id: string; targetId: string; displayName: string; servicePrefix: string; enabled: boolean;
  dashboardEnabled: boolean; panelEnabled: boolean; flowKpi: "database" | "redis" | null; critical: boolean;
  displayOrder: number; revision: number;
};

const fresh = (until: string | null | undefined, now: number) => !!until && Date.parse(until) > now;

function reading(metric: { value: number | null; quality: string } | undefined) {
  return metric?.quality === "fresh" ? metric.value : null;
}

function observedContainer(container: Container, now: number): ServiceObservedContainer {
  return {
    hostKey: container.hostKey, name: container.name, status: container.status,
    statusFresh: fresh(container.evidence.validUntil, now),
    health: container.health, healthFresh: fresh(container.healthValidUntil, now),
    cpu: reading(container.metrics.cpuUsagePercent),
    memory: reading(container.metrics.memoryUsagePercent),
    uptimeSeconds: reading(container.metrics.uptimeSeconds),
  };
}

export function presentSignalService(row: SignalServiceRow, resolution: SignalServiceResolution, vms: { linuxHostKey: string | null; name: string; displayName?: string }[]) {
  const vm = resolution.candidate ? vms.find(item => item.linuxHostKey === resolution.candidate?.hostKey) : undefined;
  return {
    ...row,
    resolution: resolution.resolution,
    reason: resolution.reason,
    kpiLabel: resolution.kpiLabel,
    tone: resolution.tone,
    statusState: resolution.statusState,
    healthState: resolution.healthState,
    hostKey: resolution.candidate?.hostKey ?? null,
    containerName: resolution.candidate?.name ?? null,
    vmName: vm?.displayName ?? vm?.name ?? null,
    healthNote: resolution.healthNote,
    cpu: resolution.candidate?.cpu ?? null,
    memory: resolution.candidate?.memory ?? null,
    uptimeSeconds: resolution.candidate?.uptimeSeconds ?? null,
  };
}

export function resolveRows(input: {
  rows: SignalServiceRow[];
  links: ServiceScopeLink[];
  vms: ServiceScopeVm[];
  hosts: ServiceScopeHost[];
  containers: ServiceObservedContainer[];
  coverage: ServiceHostCoverage[];
  names: { linuxHostKey: string | null; name: string; displayName?: string }[];
}) {
  return input.rows.map(row => presentSignalService(row, resolveSignalService({
    servicePrefix: row.servicePrefix, links: input.links, vms: input.vms, hosts: input.hosts, containers: input.containers, coverage: input.coverage,
  }), input.names));
}

export async function readSignalServiceEvidence(now = Date.now()) {
  const empty = { hosts: [] as Host[], containers: [] as Container[], coverage: [] as ServiceHostCoverage[], names: [] as { linuxHostKey: string | null; name: string; displayName?: string }[], disabledHostKeys: [] as string[], readable: false };
  const first = await readSnapshotBatch([snapshotKeys.hosts, snapshotKeys.dockerCoverage]).catch(() => null);
  if (!first) return empty;
  const hosts = snapshotData(first, snapshotKeys.hosts, z.array(hostSchema), []);
  const keys = hosts.filter(host => host.role === "linux").map(host => snapshotKeys.containers(host.hostKey));
  const batch = await readSnapshotBatch([snapshotKeys.hosts, snapshotKeys.dockerCoverage, ...keys]).catch(() => null);
  if (!batch || batch.generation !== first.generation) return empty;
  const stableHosts = snapshotData(batch, snapshotKeys.hosts, z.array(hostSchema), []);
  const coverageRaw = snapshotData(batch, snapshotKeys.dockerCoverage, dockerCoverageSchema.nullable(), null);
  const containers = keys.flatMap(key => snapshotData(batch, key, z.array(containerSchema), []));
  const coverage = (coverageRaw?.hosts ?? []).map(item => ({
    hostKey: item.hostKey, complete: item.complete, fresh: item.complete && fresh(item.validUntil, now), names: item.names,
  }));
  return {
    hosts: stableHosts, containers, coverage, readable: true,
    disabledHostKeys: (coverageRaw?.hosts ?? []).filter(item => item.disabled).map(item => item.hostKey),
    names: stableHosts.flatMap(host => host.vms.map(vm => ({ linuxHostKey: vm.linuxHostKey, name: vm.name, displayName: vm.displayName }))),
  };
}

export function evidenceInput(evidence: Awaited<ReturnType<typeof readSignalServiceEvidence>>, now: number) {
  const hosts: ServiceScopeHost[] = evidence.hosts.map(host => ({
    hostKey: host.hostKey, role: host.role, disabled: evidence.disabledHostKeys.includes(host.hostKey), readable: true,
  }));
  const vms: ServiceScopeVm[] = evidence.hosts.flatMap(host => host.vms.map(vm => ({ parentHostKey: vm.parentHostKey, vmKey: vm.vmKey, linuxHostKey: vm.linuxHostKey })));
  return { hosts, vms, containers: evidence.containers.map(container => observedContainer(container, now)), coverage: evidence.coverage, names: evidence.names };
}
