import type { Metric } from "../monitoring/contracts.ts";

export const dateFormatter = new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Fortaleza", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" });
export function timestamp(value: string | null | undefined) { return value ? dateFormatter.format(new Date(value)) : "Sem horário disponível"; }
export function number(value: number | null | undefined, digits = 0) { return value == null ? "—" : value.toLocaleString("pt-BR", { maximumFractionDigits: digits }); }
export function metricValue(metric: Metric | undefined) {
  if (!metric || metric.value === null || metric.quality === "unsupported" || metric.quality === "missing") return "Sem dados";
  const { value, unit } = metric;
  if (unit === "percent") return number(value, 1) + "%";
  if (unit === "count") return number(value);
  if (unit === "seconds") {
    if (value < 60) return number(value) + " s";
    if (value < 3600) return number(Math.floor(value / 60)) + " min";
    if (value < 86400) return number(Math.floor(value / 3600)) + " h " + number(Math.floor(value % 3600 / 60)) + " min";
    return number(Math.floor(value / 86400)) + " d " + number(Math.floor(value % 86400 / 3600)) + " h";
  }
  const base = unit === "bits/s" ? 1000 : 1024;
  const labels = unit === "bits/s" ? ["bit/s", "kbit/s", "Mbit/s", "Gbit/s", "Tbit/s"] : unit === "bytes/s" ? ["B/s", "KiB/s", "MiB/s", "GiB/s", "TiB/s"] : ["B", "KiB", "MiB", "GiB", "TiB"];
  const index = Math.min(4, Math.max(0, Math.floor(Math.log(Math.max(1, Math.abs(value))) / Math.log(base))));
  return number(value / base ** index, 1) + " " + labels[index];
}
export function isOld(metric: Metric | undefined, stale = false, now = Date.now()) {
  return !!metric && (stale || metric.quality === "stale" || (!!metric.validUntil && Date.parse(metric.validUntil) < now));
}
export function qualityText(metric: Metric | undefined, stale = false, now = Date.now()) {
  if (metric?.quality === "unsupported") return "Não suportado pela origem";
  if (!metric || metric.value === null || metric.quality === "missing") return "Métrica não disponível";
  return isOld(metric, stale, now) ? "Dado desatualizado" : "Amostra observada";
}
