import type { Metric } from "../monitoring/contracts.ts";
import type { StoragePreferences } from "../config/storages.ts";
import { storageViewSchema, type StorageCapacity, type StorageView, type StorageVolume } from "./contracts.ts";

function aggregate(metrics: Metric[], unit: Metric["unit"], calculate: (values: number[]) => number): Metric | undefined {
  if (!metrics.length || metrics.some(metric => metric.value === null || !Number.isFinite(metric.value) || !metric.observedAt || !["fresh", "stale"].includes(metric.quality))) return undefined;
  const value = calculate(metrics.map(metric => metric.value!));
  if (!Number.isFinite(value)) return undefined;
  return { value, unit, quality: metrics.some(metric => metric.quality === "stale") ? "stale" : "fresh", observedAt: metrics.map(metric => metric.observedAt!).sort()[0], validUntil: metrics.every(metric => metric.validUntil) ? metrics.map(metric => metric.validUntil!).sort()[0] : null };
}
export function storageCapacity(volumes: StorageVolume[], preference?: Pick<StoragePreferences, "filesystemKeys" | "independentVolumesConfirmed">): StorageCapacity {
  const root = volumes.find(volume => volume.name === "/");
  const keys = preference?.filesystemKeys ?? (root ? [root.key] : volumes.length === 1 ? [volumes[0].key] : []);
  const selected = keys.map(key => volumes.find(volume => volume.key === key));
  const label = preference?.filesystemKeys ? `Volumes selecionados · ${keys.length}` : selected[0] ? `Filesystem ${selected[0].name}` : "Selecionar volumes";
  const base: StorageCapacity = { coverage: keys.length ? "incomplete" : "unconfigured", label, filesystemKeys: keys };
  if (!keys.length || new Set(keys).size !== keys.length || keys.length > 1 && !preference?.independentVolumesConfirmed || selected.some(volume => !volume)) return base;
  const pairs = selected.map(volume => [volume!.metrics.diskUsedBytes, volume!.metrics.diskTotalBytes] as const);
  if (pairs.some(([used, total]) => !used || !total || used.value === null || total.value === null || used.value < 0 || total.value <= 0 || used.value > total.value)) return base;
  const operands = pairs.flatMap(([used, total]) => [used!, total!]);
  const usedBytes = aggregate(operands, "bytes", values => values.filter((_, i) => i % 2 === 0).reduce((a, b) => a + b, 0));
  const totalBytes = aggregate(operands, "bytes", values => values.filter((_, i) => i % 2 === 1).reduce((a, b) => a + b, 0));
  const usagePercent = aggregate(operands, "percent", values => 100 * values.filter((_, i) => i % 2 === 0).reduce((a, b) => a + b, 0) / values.filter((_, i) => i % 2 === 1).reduce((a, b) => a + b, 0));
  const available = selected.map(volume => volume!.availableBytes);
  const availableBytes = available.every((metric): metric is Metric => !!metric && metric.value !== null && metric.value >= 0) ? aggregate(available, "bytes", values => values.reduce((a, b) => a + b, 0)) : undefined;
  return { ...base, coverage: usagePercent ? "complete" : "incomplete", usedBytes, totalBytes, usagePercent, availableBytes };
}
export function storageStatus(item: StorageView, now = Date.now()): { label: string; tone: "good" | "warn" | "bad" | "unknown" } {
  if (item.resolution === "monitoring_disabled") return { label: "Monitoramento desativado", tone: "unknown" };
  if (item.resolution !== "resolved") return { label: item.resolution === "tag_missing" ? "Tag removida" : item.resolution === "host_missing" ? "Host ausente" : "Sem dados", tone: "unknown" };
  if (!item.evidence.observedAt && !item.stale) return { label: "Sem dados", tone: "unknown" };
  if (item.stale || !item.classification.validUntil || Date.parse(item.classification.validUntil) <= now || !item.evidence.validUntil || Date.parse(item.evidence.validUntil) <= now) return { label: "Desatualizado", tone: "unknown" };
  if (item.availability === "unreachable") return { label: "Indisponível", tone: "bad" };
  if (item.availability !== "reachable") return { label: "Sem dados", tone: "unknown" };
  const busy = [item.metrics.cpuUsagePercent, item.metrics.memoryUsagePercent].every(metric => metric?.quality === "fresh" && metric.value !== null && metric.value >= 90 && !!metric.validUntil && Date.parse(metric.validUntil) > now);
  return { label: busy ? "Atenção" : "Disponível", tone: busy ? "warn" : "good" };
}
export function publicStorage(item: StorageView): StorageView {
  item = storageViewSchema.parse(item);
  const labels = new Map(item.volumes.map((volume, index) => [volume.key, `Volume ${index + 1}`]));
  return {
    ...item, technicalName: item.displayName, description: null,
    capacity: { ...item.capacity, label: item.capacity.coverage === "unconfigured" ? "Capacidade não configurada" : `Volumes monitorados · ${item.capacity.filesystemKeys.length}` },
    volumes: item.volumes.map(volume => ({ ...volume, name: labels.get(volume.key)!, filesystemType: null })),
    interfaces: [], selectedInterface: item.selectedInterface ? { ...item.selectedInterface, name: "Interface monitorada" } : null,
  };
}

