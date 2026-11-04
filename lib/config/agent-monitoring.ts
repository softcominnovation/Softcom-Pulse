import { z } from "zod";

export type CardMetric = "cpu" | "memory" | "disk";
export type CardMetrics = [CardMetric, CardMetric] | [CardMetric, CardMetric, CardMetric];

export const cardMetricsSchema = z.union([
  z.tuple([z.literal("cpu"), z.literal("memory")]),
  z.tuple([z.literal("cpu"), z.literal("disk")]),
  z.tuple([z.literal("disk"), z.literal("memory")]),
  z.tuple([z.literal("cpu"), z.literal("memory"), z.literal("disk")]),
]).transform(metrics => metrics as CardMetrics);
/** Only an explicit trio changes the visual order; persisted pairs keep their order. */
export function cardMetricOrder(metrics: readonly CardMetric[]): CardMetric[] {
  return metrics.length === 3 ? ["disk", "cpu", "memory"] : [...metrics];
}
export function legacyCardMetrics(presentation: { showCpu?: unknown; showMemory?: unknown; showDisk?: unknown }): CardMetric[] {
  if (presentation.showDisk === true) return presentation.showCpu === true ? ["cpu", "disk"] : presentation.showMemory === true ? ["disk", "memory"] : ["disk"];
  return [...(presentation.showCpu === true ? ["cpu" as const] : []), ...(presentation.showMemory === true ? ["memory" as const] : [])];
}
export function cardMetricPresentation(metrics: CardMetrics) {
  return { cardMetrics: [...metrics] as CardMetrics, showCpu: metrics.includes("cpu"), showMemory: metrics.includes("memory"), showDisk: metrics.includes("disk") };
}
export function mergeCardMetricPresentation(current: Record<string, unknown>, patch: Record<string, unknown>) {
  const merged = { ...current, ...patch };
  const incoming = cardMetricsSchema.safeParse(patch.cardMetrics), previous = cardMetricsSchema.safeParse(current.cardMetrics);
  const pairChanged = incoming.success && (!previous.success || JSON.stringify(incoming.data) !== JSON.stringify(previous.data));
  const flagsChanged = ["showCpu", "showMemory", "showDisk"].some(key => typeof patch[key] === "boolean" && patch[key] !== current[key]);
  // An old editor can echo the unchanged hidden pair while the user edits its checkboxes.
  if (flagsChanged && !pairChanged) {
    const pair = cardMetricsSchema.safeParse(legacyCardMetrics(merged));
    if (pair.success) return { ...merged, ...cardMetricPresentation(pair.data) };
    delete merged.cardMetrics;
    return merged;
  }
  const pair = cardMetricsSchema.safeParse(merged.cardMetrics);
  return pair.success ? { ...merged, ...cardMetricPresentation(pair.data) } : merged;
}
export const metricNames: Record<CardMetric, string> = { cpu: "CPU", memory: "RAM", disk: "Disco da VM" };
export const agentCapacityRequiredMessage = "Selecione ao menos um volume em Armazenamento monitorado para usar o alerta de disco ou Disco no minicard.";
export const capacitySelectionSchema = z.strictObject({
  filesystemKeys: z.array(z.string().regex(/^device-[a-f0-9]{32}$/)).max(32).refine(keys => new Set(keys).size === keys.length).transform(keys => [...keys].sort()).default([]),
  independentVolumesConfirmed: z.boolean().default(false),
}).refine(value => value.filesystemKeys.length < 2 || value.independentVolumesConfirmed, { path: ["independentVolumesConfirmed"], message: "Confirme que os volumes selecionados são independentes e não duplicam a mesma capacidade." });
const limit = z.number().int().min(1).max(100).nullable().default(null);
export const agentMonitoringSchema = z.strictObject({
  schemaVersion: z.literal(1),
  vmBinding: z.strictObject({ parentHostKey: z.string().min(1).max(256), vmKey: z.string().regex(/^vm-[a-f0-9]{32}$/) }),
  capacity: capacitySelectionSchema,
  thresholds: z.strictObject({ cpu: limit, memory: limit, disk: limit }),
}).refine(value => value.thresholds.disk === null || value.capacity.filesystemKeys.length > 0, { path: ["capacity", "filesystemKeys"], message: agentCapacityRequiredMessage });
export const optionalAgentMonitoringSchema = z.union([agentMonitoringSchema, z.strictObject({})]).default({});
export type AgentMonitoring = z.infer<typeof agentMonitoringSchema>;
export function agentMonitoring(value: unknown): AgentMonitoring | null {
  const result = agentMonitoringSchema.safeParse(value);
  return result.success ? result.data : null;
}
export const metricContextSchema = z.object({
  metric: z.enum(["cpu", "memory", "disk"]), valuePercent: z.number().finite().nonnegative(),
  thresholdPercent: z.number().min(1).max(100), recoveryPercent: z.number().nonnegative(),
  source: z.literal("agent"), observedAt: z.iso.datetime(), coverage: z.string().max(120),
});
export type MetricContext = z.infer<typeof metricContextSchema>;
