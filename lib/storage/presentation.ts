import { filesystemCapacity } from "../monitoring/filesystem-capacity.ts";
import { storageViewSchema, type StorageView } from "./contracts.ts";

export const storageCapacity = filesystemCapacity;
/** Keep the inventory intact for capacity/alerts and apply only the display preference. */
export function visibleStorageVolumes(item: StorageView) {
  return item.visibleFilesystemKeys == null ? item.volumes : item.volumes.filter(volume => item.visibleFilesystemKeys!.includes(volume.key));
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

