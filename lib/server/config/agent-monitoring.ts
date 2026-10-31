import "server-only";
import { z } from "zod";
import { Prisma } from "../../../generated/prisma/client.ts";
import { agentMonitoringSchema, agentMonitoring, cardMetricPresentation, cardMetricsSchema, capacitySelectionSchema, legacyCardMetrics } from "../../config/agent-monitoring.ts";
import { hostKeySchema, hostPresentationSchema, resourceInputSchema } from "../../config/resources.ts";
import { agentCapacity, agentBindingValid } from "../../monitoring/agent-monitoring.ts";
import { readInventory } from "../monitoring/inventory.ts";
import { readResult, snapshotKeys } from "../cache/snapshots.ts";
import { getPrisma } from "../prisma.ts";
import { BffError } from "../bff.ts";
import { notificationDecision } from "../../notifications/policy.ts";
import { notificationSettings } from "../notifications/settings.ts";
import { buildDemoHosts, isDemoMode } from "../monitoring/demo-data.ts";
import { opaqueReference } from "../zabbix/observations.ts";

export const agentMonitoringWriteSchema = z.strictObject({
  expectedRevision: z.number().int().nonnegative(), vmBinding: agentMonitoringSchema.shape.vmBinding,
  capacity: capacitySelectionSchema, thresholds: agentMonitoringSchema.shape.thresholds,
  cardMetrics: cardMetricsSchema.optional(), metricsSource: z.enum(["agent", "hypervisor", "auto"]).optional(), critical: z.boolean().optional(),
});
async function context(hostKey: string) {
  hostKeySchema.parse(hostKey);
  const inventory = await readInventory().catch(() => ({ hosts: [], batch: { snapshots: new Map(), sync: null, generation: null } }));
  const host = inventory.hosts.find(host => host.hostKey === hostKey && host.role === "linux");
  const vms = inventory.hosts.flatMap(host => host.vms).filter(vm => vm.linuxHostKey === hostKey && !vm.name.startsWith("tpl"));
  const current = await getPrisma().monitoredResourceConfig.findFirst({ where: { resourceType: "host", zabbixHostKey: hostKey } });
  return { inventory, host, vm: vms.length === 1 ? vms[0] : null, current, stale: readResult(null, inventory.batch, [snapshotKeys.hosts]).stale || readResult(null, inventory.batch, [snapshotKeys.hosts]).availability !== "ready" };
}
export async function readAgentMonitoring(hostKey: string) {
  if (isDemoMode()) return demoAgentMonitoring(hostKey);
  const { host, vm, current, stale, inventory } = await context(hostKey);
  const settings = agentMonitoring(current?.agentMonitoring);
  const presentation = hostPresentationSchema.parse(current?.presentation ?? {});
  const binding = vm ? { parentHostKey: vm.parentHostKey, vmKey: vm.vmKey } : settings?.vmBinding;
  const policy = await notificationSettings();
  const effective = notificationDecision(policy.data, { targetRef: current ? `resource:${current.id}` : "", critical: current?.critical ?? false, monitoringEnabled: current?.enabled ?? true, eventType: "usage", severity: "warning" });
  return {
    hostKey, name: vm?.displayName ?? vm?.name ?? host?.displayName ?? host?.name ?? hostKey, resourceId: current?.id ?? null,
    revision: current?.revision ?? 0, eligible: !!host && !!vm && !stale, stale,
    currentVmBinding: vm ? { parentHostKey: vm.parentHostKey, vmKey: vm.vmKey } : null,
    bindingValid: !settings || agentBindingValid(hostKey, settings, inventory.hosts),
    settings: settings ?? (binding ? { schemaVersion: 1 as const, vmBinding: binding, capacity: { filesystemKeys: [], independentVolumesConfirmed: false }, thresholds: { cpu: null, memory: null, disk: null } } : null),
    cardMetrics: cardMetricsSchema.safeParse(presentation.cardMetrics ?? legacyCardMetrics(presentation)).data,
    metricsSource: presentation.metricsSource,
    critical: current?.critical ?? false, monitoringEnabled: current?.enabled ?? true, notificationEnabled: effective.enabled, soundEnabled: !!effective.sound,
    volumes: host?.filesystems ?? [], capacity: host ? agentCapacity(host, settings) : null, metrics: host?.metrics ?? {},
  };
}
export async function saveAgentMonitoring(hostKey: string, body: unknown) {
  const input = agentMonitoringWriteSchema.parse(body);
  if ((input.thresholds.disk !== null || input.cardMetrics?.includes("disk")) && !input.capacity.filesystemKeys.length) throw new BffError(400, "capacity_required");
  if (isDemoMode()) return demoAgentMonitoring(hostKey, input);
  const settings = agentMonitoringSchema.parse({ schemaVersion: 1, vmBinding: input.vmBinding, capacity: input.capacity, thresholds: input.thresholds });
  const ctx = await context(hostKey);
  const old = agentMonitoring(ctx.current?.agentMonitoring);
  const newlyEnabled = (["cpu", "memory", "disk"] as const).some(kind => settings.thresholds[kind] !== null && (old?.thresholds[kind] ?? null) === null);
  const changedBinding = JSON.stringify(settings.vmBinding) !== JSON.stringify(old?.vmBinding);
  const changedVolumes = JSON.stringify(settings.capacity.filesystemKeys.slice().sort()) !== JSON.stringify(old?.capacity.filesystemKeys.slice().sort());
  if (!ctx.current || changedBinding || changedVolumes || newlyEnabled) {
    if (!ctx.host || !ctx.vm || ctx.stale) throw new BffError(409, "agent_monitoring_unavailable");
    if (ctx.vm.vmKey !== input.vmBinding.vmKey || ctx.vm.parentHostKey !== input.vmBinding.parentHostKey) throw new BffError(409, "agent_context_changed");
    if (settings.capacity.filesystemKeys.some(key => !ctx.host!.filesystems.some(fs => fs.key === key))) throw new BffError(409, "agent_context_changed");
  }
  try {
    await getPrisma().$transaction(async tx => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(734021003::bigint)`;
      const current = await tx.monitoredResourceConfig.findFirst({ where: { resourceType: "host", zabbixHostKey: hostKey } });
      if ((current?.revision ?? 0) !== input.expectedRevision) throw new BffError(409, "revision_conflict");
      const presentation = { ...(current?.presentation as Record<string, unknown> ?? {}), ...(input.cardMetrics ? cardMetricPresentation(input.cardMetrics) : {}), ...(input.metricsSource ? { metricsSource: input.metricsSource } : {}) };
      if (current) await tx.monitoredResourceConfig.update({ where: { id: current.id }, data: { agentMonitoring: settings, presentation, ...(input.critical === undefined ? {} : { critical: input.critical }) } });
      else await tx.monitoredResourceConfig.create({ data: resourceInputSchema.parse({ resourceType: "host", zabbixHostKey: hostKey, dashboardEnabled: false, critical: input.critical ?? false, presentation, agentMonitoring: settings }) });
    }, { maxWait: 3000, timeout: 5000 });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") throw new BffError(409, "revision_conflict");
    throw error;
  }
  return readAgentMonitoring(hostKey);
}

function demoAgentMonitoring(hostKey: string, input?: z.infer<typeof agentMonitoringWriteSchema>) {
  hostKeySchema.parse(hostKey);
  const hosts = buildDemoHosts(), host = hosts.find(h => h.hostKey === hostKey && h.role === "linux");
  const vm = hosts.flatMap(h => h.vms).find(vm => vm.linuxHostKey === hostKey);
  if (!host || !vm) throw new BffError(404, "vm_not_found");
  const vmBinding = { parentHostKey: vm.parentHostKey, vmKey: opaqueReference("vm", vm.parentHostKey, vm.vmKey) };
  const volumes = host.filesystems.map(fs => ({ ...fs, key: opaqueReference("device", hostKey, fs.key), metrics: Object.fromEntries(Object.entries(fs.metrics).map(([key,m]) => [key, { ...m, validUntil: new Date(Date.now()+300000).toISOString() }])) }));
  const settings = agentMonitoringSchema.parse({ schemaVersion: 1, vmBinding, capacity: input?.capacity ?? { filesystemKeys: [], independentVolumesConfirmed: false }, thresholds: input?.thresholds ?? { cpu: null, memory: null, disk: null } });
  if (input && (JSON.stringify(input.vmBinding) !== JSON.stringify(vmBinding) || input.capacity.filesystemKeys.some(key => !volumes.some(fs => fs.key === key)))) throw new BffError(409, "agent_context_changed");
  if (input?.cardMetrics?.includes("disk") && !settings.capacity.filesystemKeys.length) throw new BffError(400, "capacity_required");
  return { demo: true, name: vm.displayName ?? vm.name, hostKey, resourceId: null, revision: input ? input.expectedRevision+1 : 0, eligible: true, stale: false, currentVmBinding: vmBinding, bindingValid: true, settings,
    cardMetrics: input?.cardMetrics, metricsSource: input?.metricsSource ?? "hypervisor", critical: input?.critical ?? false, monitoringEnabled: true, notificationEnabled: false, soundEnabled: false,
    volumes, metrics: Object.fromEntries(Object.entries(host.metrics).map(([key,m]) => [key, { ...m, validUntil: new Date(Date.now()+300000).toISOString() }])), capacity: agentCapacity({ ...host, filesystems: volumes }, settings) };
}
