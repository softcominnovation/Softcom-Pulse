import type { History, Host, Metric } from "../monitoring/contracts.ts";
import { metricValue } from "../dashboard/format.ts";

export const metricLabels: Record<string, string> = {
  cpuUsagePercent: "CPU", provisionedCpuCount: "vCPUs provisionadas · Proxmox", osCpuCount: "CPUs reconhecidas · SO", cpuCount: "CPUs reconhecidas · SO", memoryUsagePercent: "RAM", memoryUsedBytes: "RAM usada", memoryTotalBytes: "RAM total",
  diskUsagePercent: "Disco ocupado", diskUsedBytes: "Disco usado", diskTotalBytes: "Capacidade do disco",
  diskReadBytesPerSecond: "Leitura", diskWriteBytesPerSecond: "Escrita", networkReceiveBitsPerSecond: "Recebido", networkTransmitBitsPerSecond: "Enviado", uptimeSeconds: "Tempo ativo", restartCount: "Reinícios",
};
export type ChartSeries = History["series"][number] & { label: string; color: string };
export type ChartGroup = { key: string; label: string; unit: Metric["unit"]; series: ChartSeries[] };
export function historyGroups(history: History, host?: Host): ChartGroup[] {
  const devices = [...host?.storages ?? [], ...host?.filesystems ?? [], ...host?.interfaces ?? []];
  const groups = new Map<string, ChartGroup>();
  for (const series of history.series) {
    const parts = series.key.split("."), metric = parts.at(-1)!;
    const device = parts.length > 1 ? devices.find(item => item.key === parts[1]) : undefined;
    const subject = parts.length > 1 ? device?.name ?? "Dispositivo sem identificação atual" : "";
    const family = metric.startsWith("memory") ? "RAM" : metric.startsWith("disk") ? "Disco" : metric.startsWith("network") ? "Rede" : metric.startsWith("cpu") || metric === "provisionedCpuCount" || metric === "osCpuCount" ? "CPU" : "Tempo ativo";
    const key = `${parts.slice(0, -1).join(".")}:${series.unit}:${series.unit === "percent" ? "usage" : family}`;
    const label = `${subject ? subject + " · " : ""}${series.unit === "percent" ? "Uso (%)" : family + (series.unit === "bytes" ? " (capacidade)" : series.unit.endsWith("/s") ? " (taxa)" : "")}`;
    if (!groups.has(key)) groups.set(key, { key, label, unit: series.unit, series: [] });
    groups.get(key)!.series.push({ ...series, label: metricLabels[metric] ?? metric, color: family === "RAM" ? "#80bdf2" : family === "Disco" ? "#f2c275" : family === "CPU" ? "#64d6b0" : metric.includes("Transmit") ? "#80bdf2" : "#64d6b0" });
  }
  const priority = (group: ChartGroup) => group.series.some(series => series.key === "cpuUsagePercent") ? 0 : group.series.some(series => series.key === "memoryUsedBytes" || series.key === "memoryUsagePercent") ? 1 : group.unit === "percent" ? 2 : group.unit === "seconds" ? 9 : 3;
  return [...groups.values()].sort((a, b) => priority(a) - priority(b));
}
export function alignSeries(series: ChartSeries[]): [number[], ...(number | null)[][]] {
  const times = [...new Set(series.flatMap(item => item.points.map(point => Date.parse(point.timestamp) / 1000)))].sort((a, b) => a - b);
  return [times, ...series.map(item => {
    const values = new Map(item.points.map(point => [Date.parse(point.timestamp) / 1000, point.value]));
    return times.map(time => values.get(time) ?? null);
  })];
}
export function historyValue(value: number | null | undefined, unit: Metric["unit"]) {
  return value == null ? "Sem dados" : metricValue({ value, unit, quality: "fresh", observedAt: "2000-01-01T00:00:00Z" });
}
