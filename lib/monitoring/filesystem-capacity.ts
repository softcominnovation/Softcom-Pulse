import type { Metric } from "./contracts.ts";

type Volume = { key: string; name: string; metrics: { diskUsedBytes?: Metric; diskTotalBytes?: Metric }; availableBytes?: Metric };
type Selection = { filesystemKeys: string[] | null; independentVolumesConfirmed: boolean };
function aggregate(metrics: Metric[], unit: Metric["unit"], calculate: (values: number[]) => number): Metric | undefined {
  if (!metrics.length || metrics.some(metric => metric.value === null || !Number.isFinite(metric.value) || !metric.observedAt || !["fresh", "stale"].includes(metric.quality))) return undefined;
  const value = calculate(metrics.map(metric => metric.value!));
  if (!Number.isFinite(value)) return undefined;
  return { value, unit, quality: metrics.some(metric => metric.quality === "stale") ? "stale" : "fresh", observedAt: metrics.map(metric => metric.observedAt!).sort()[0], validUntil: metrics.every(metric => metric.validUntil) ? metrics.map(metric => metric.validUntil!).sort()[0] : null };
}
export function filesystemCapacity(volumes: Volume[], preference?: Selection) {
  const root = volumes.find(volume => volume.name === "/");
  const keys = preference?.filesystemKeys ?? (root ? [root.key] : volumes.length === 1 ? [volumes[0].key] : []);
  const selected = keys.map(key => volumes.find(volume => volume.key === key));
  const label = preference?.filesystemKeys ? `Volumes selecionados · ${keys.length}` : selected[0] ? `Filesystem ${selected[0].name}` : "Selecionar volumes";
  const base = { coverage: keys.length ? "incomplete" as const : "unconfigured" as const, label, filesystemKeys: keys };
  if (!keys.length || new Set(keys).size !== keys.length || keys.length > 1 && !preference?.independentVolumesConfirmed || selected.some(volume => !volume)) return { ...base, usedBytes: undefined, totalBytes: undefined, usagePercent: undefined, availableBytes: undefined };
  const pairs = selected.map(volume => [volume!.metrics.diskUsedBytes, volume!.metrics.diskTotalBytes] as const);
  if (pairs.some(([used, total]) => !used || !total || used.value === null || total.value === null || used.value < 0 || total.value <= 0 || used.value > total.value)) return { ...base, usedBytes: undefined, totalBytes: undefined, usagePercent: undefined, availableBytes: undefined };
  const operands = pairs.flatMap(([used, total]) => [used!, total!]);
  const sum = (values: number[], parity: number) => values.filter((_, i) => i % 2 === parity).reduce((a, b) => a + b, 0);
  const usedBytes = aggregate(operands, "bytes", values => sum(values, 0));
  const totalBytes = aggregate(operands, "bytes", values => sum(values, 1));
  const usagePercent = aggregate(operands, "percent", values => 100 * sum(values, 0) / sum(values, 1));
  const available = selected.map(volume => volume!.availableBytes);
  const availableBytes = available.every((metric): metric is Metric => !!metric && metric.value !== null && metric.value >= 0) ? aggregate(available, "bytes", values => values.reduce((a, b) => a + b, 0)) : undefined;
  return { ...base, coverage: usagePercent ? "complete" as const : "incomplete" as const, usedBytes, totalBytes, usagePercent, availableBytes };
}
