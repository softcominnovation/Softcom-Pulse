import { z } from "zod";
import { hostKeySchema, historyRangeSchema, resourceConfigSchema, type ResourceConfig } from "../config/resources.ts";
import type { BlockType } from "../config/presentation.ts";

export const isoSchema = z.iso.datetime({ offset: true });
const name = z.string().min(1).max(512);
const opaqueId = z.string().min(1).max(256);
export const metricSchema = z.object({
  value: z.number().finite().nullable(), unit: z.enum(["percent", "bytes", "bytes/s", "bits/s", "seconds", "count"]),
  observedAt: isoSchema.nullable(), quality: z.enum(["fresh", "stale", "missing", "unsupported"]),
  validUntil: isoSchema.nullable().optional(),
}).refine(metric => metric.value === null || (metric.observedAt !== null && ["fresh", "stale"].includes(metric.quality)));
export const metricsSchema = z.object({
  cpuUsagePercent: metricSchema.optional(), provisionedCpuCount: metricSchema.optional(), osCpuCount: metricSchema.optional(), memoryUsedBytes: metricSchema.optional(), memoryTotalBytes: metricSchema.optional(),
  memoryUsagePercent: metricSchema.optional(), diskUsedBytes: metricSchema.optional(), diskTotalBytes: metricSchema.optional(),
  diskUsagePercent: metricSchema.optional(), diskReadBytesPerSecond: metricSchema.optional(), diskWriteBytesPerSecond: metricSchema.optional(),
  networkReceiveBitsPerSecond: metricSchema.optional(), networkTransmitBitsPerSecond: metricSchema.optional(), uptimeSeconds: metricSchema.optional(),
  restartCount: metricSchema.optional(),
});
const evidenceSchema = z.object({ source: z.literal("zabbix"), observedAt: isoSchema.nullable(), basis: z.enum(["item", "discovery", "configuration", "unknown"]), validUntil: isoSchema.nullable().optional() });
const observedAvailability = z.enum(["reachable", "unreachable", "unknown"]);
const presentationFields = {
  displayName: name.optional(), presentationStatus: z.enum(["ready", "unavailable"]).optional(), nameConflict: z.boolean().optional(),
  resourceConfigurations: z.array(z.object({ id: z.uuid(), displayName: z.string().nullable(), enabled: z.boolean(), dashboardEnabled: z.boolean() })).optional(),
};
export const vmSchema = z.object({
  ...presentationFields,
  vmKey: opaqueId, vmId: z.string().max(64).nullable(), name, parentHostKey: hostKeySchema,
  state: z.enum(["running", "stopped", "paused", "unknown"]), metrics: metricsSchema,
  linuxHostKey: hostKeySchema.nullable(), evidence: evidenceSchema,
});
const deviceSchema = z.object({ key: opaqueId, name, metrics: metricsSchema });
export const hostSchema = z.object({
  ...presentationFields,
  hostKey: hostKeySchema, name, role: z.enum(["hypervisor", "linux", "unknown"]), availability: observedAvailability,
  metrics: metricsSchema.extend({ cpuCount: metricSchema.optional() }), storages: z.array(deviceSchema), filesystems: z.array(deviceSchema), interfaces: z.array(deviceSchema),
  vms: z.array(vmSchema), evidence: evidenceSchema,
}).transform(({ metrics, ...host }) => {
  const { cpuCount, ...explicit } = metrics;
  return { ...host, metrics: { ...explicit, ...(host.role === "linux" && !explicit.osCpuCount && cpuCount ? { osCpuCount: cpuCount } : {}) } };
});
export const containerSchema = z.object({
  ...presentationFields,
  reference: opaqueId, hostKey: hostKeySchema, name, image: z.string().max(1024).nullable(),
  status: z.enum(["running", "stopped", "paused", "restarting", "created", "removing", "dead", "unknown"]),
  health: z.enum(["healthy", "unhealthy", "starting", "not_configured", "unknown"]),
  healthReason: z.enum(["observed", "missing", "unsupported", "stale", "unrecognized"]).optional(),
  healthObservedAt: isoSchema.nullable().optional(), healthValidUntil: isoSchema.nullable().optional(),
  metrics: metricsSchema, evidence: evidenceSchema,
});
export const resourceReferenceSchema = z.object({
  type: z.enum(["host", "vm", "docker_container", "configured_resource"]),
  hostKey: hostKeySchema, reference: opaqueId.nullable(),
});
export const problemSchema = z.object({
  resourceDisplayName: z.string().optional(),
  id: opaqueId, resource: resourceReferenceSchema, description: z.string().max(4096), displayDescription: z.string().max(4096).optional(),
  severity: z.number().int().min(0).max(5), visualState: z.enum(["info", "warning", "critical", "unknown"]), startedAt: isoSchema,
});
const count = z.number().int().nonnegative().nullable();
export const summarySchema = z.object({ hostsKnown: count, hostsReachable: count, vms: count, containersRunning: count, containersStopped: count, containersTotal: count.optional(), problems: count, criticalAffected: count });
export const asgardSummarySchema = z.object({ host: hostSchema.nullable(), vms: z.array(vmSchema) });
export const overviewSnapshotSchema = z.object({ summary: summarySchema, asgardSummary: asgardSummarySchema });
export const historySchema = z.object({
  resource: resourceReferenceSchema, window: historyRangeSchema, source: z.enum(["history", "trends"]),
  technicalReference: opaqueId.optional(), coverageLimited: z.boolean().optional(),
  series: z.array(z.object({ key: name, unit: metricSchema.shape.unit, aggregation: z.enum(["last_min_max", "hourly_average"]).optional(),
    points: z.array(z.object({ timestamp: isoSchema, value: z.number().finite().nullable(), min: z.number().finite().nullable().optional(), max: z.number().finite().nullable().optional() })).max(1000) })),
  states: z.array(z.object({ key: z.enum(["health", "status"]), aggregation: z.literal("worst_state"), coverageLimited: z.boolean(),
    segments: z.array(z.object({ from: isoSchema, to: isoSchema, state: name, observedAt: isoSchema.nullable() })).max(1000) })).optional(),
});
export type Metric = z.infer<typeof metricSchema>;
export type Metrics = z.infer<typeof metricsSchema>;
export type Host = z.infer<typeof hostSchema>;
export type VirtualMachine = z.infer<typeof vmSchema>;
export type Container = z.infer<typeof containerSchema>;
export type Problem = z.infer<typeof problemSchema>;
export type Summary = z.infer<typeof summarySchema>;
export type AsgardSummary = z.infer<typeof asgardSummarySchema>;
export type History = z.infer<typeof historySchema>;
export type Availability = "ready" | "no_data" | "unavailable";
export type ReadResult<T> = { presentationStatus?: "ready" | "unavailable"; data: T; availability: Availability; stale: boolean; lastUpdated: string | null; refreshAfterMs: number };
export type ConfiguredResource = {
  id: string; config: ResourceConfig; resolved: boolean; resolution: "resolved" | "missing" | "ambiguous";
  resource: Host | Container | null; metrics: Metrics; linkedVmName?: string;
};
export const configuredResourceSchema = z.object({ id: z.uuid(), config: resourceConfigSchema, resolved: z.boolean(), resolution: z.enum(["resolved", "missing", "ambiguous"]), resource: z.union([hostSchema, containerSchema]).nullable(), metrics: metricsSchema });
export const vmWorkloadsSchema = z.object({ vm: vmSchema, association: z.enum(["linked", "unlinked", "host_unavailable"]), containers: z.array(containerSchema), configuredServices: z.array(configuredResourceSchema) });
export type VmWorkloads = z.infer<typeof vmWorkloadsSchema>;
export type OverviewBlock = Omit<ReadResult<Summary | AsgardSummary | ConfiguredResource | ConfiguredResource[] | Problem[] | Host[] | Container[] | ProbeCard[] | null>, "refreshAfterMs"> & { blockId: string; type: BlockType; options?: Record<string, unknown> };
export type ProbeCard = {
  id: string; displayName: string; description: string | null; serviceType: string | null; displayOrder: number; critical: boolean; dashboardEnabled: boolean; paused: boolean; progressStartedAt: string | null;
  reason: number | null; latencyMs: number | null; checkedAt: string | null; httpStatus: number | null; certNotAfter: string | null;
  uptime24h: { available: number; total: number } | null; strip: number[];
};
export type Overview = {
  summary: Summary; highlightedResources: ConfiguredResource[]; problems: Problem[]; asgardSummary: AsgardSummary;
  screenId: string; presentationRevision: number; blocks: OverviewBlock[];
  externalServices?: ProbeCard[]; uptimeBoard?: ProbeCard[];
  standaloneVps?: { id: string; name: string; provider: string | null; enabled: boolean; monitorConfigured: boolean; monitorState: string; strip: number[] }[];
};
export function emptySummary(): Summary {
  return { hostsKnown: null, hostsReachable: null, vms: null, containersRunning: null, containersStopped: null, problems: null, criticalAffected: null };
}
