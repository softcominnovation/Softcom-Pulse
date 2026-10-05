"use client";

import { createContext, useContext } from "react";
import type { Metric } from "@/lib/monitoring/contracts";
import { isOld, metricValue, qualityText, timestamp } from "@/lib/dashboard/format";

export const EvidenceTimeContext = createContext(0);
export function MetricValue({ metric, stale = false, series = "cpu", compact = false, meter = true }: { metric?: Metric; stale?: boolean; series?: "cpu" | "memory" | "disk"; compact?: boolean; meter?: boolean }) {
  const now = useContext(EvidenceTimeContext);
  const old = isOld(metric, stale, now), valid = metric?.value != null && metric.quality === "fresh" && !old;
  return <div className={`metric-value ${old ? "metric-old" : ""}`} title={compact ? `${qualityText(metric, stale, now)} · ${timestamp(metric?.observedAt)}` : undefined}>
    <strong>{metricValue(metric)}</strong>
    {meter && valid && metric.unit === "percent" && <svg className={`metric-meter series-${series}`} viewBox="0 0 100 4" preserveAspectRatio="none" aria-hidden="true"><rect width="100" height="4" rx="2" className="meter-track" /><rect width={Math.max(0, Math.min(100, metric.value!))} height="4" rx="2" className="meter-value" /></svg>}
    {(!valid || !compact) && <small>{qualityText(metric, stale, now)}</small>}
    {!compact && metric?.observedAt && <time dateTime={metric.observedAt}>{timestamp(metric.observedAt)}</time>}
  </div>;
}
const labels: Record<string, string> = {
  reachable: "Disponível", unreachable: "Indisponível", unknown: "Desconhecido", running: "Em execução", stopped: "Parado", paused: "Pausado",
  restarting: "Reiniciando", created: "Criado", removing: "Em remoção", dead: "Encerrado", healthy: "Saudável", unhealthy: "Falha no healthcheck",
  starting: "Iniciando", not_configured: "Sem healthcheck", info: "Informação", warning: "Atenção", critical: "Crítico",
};
export function Status({ value, stale = false }: { value: string; stale?: boolean }) {
  const state = stale ? "unknown" : value;
  const color = ["reachable", "running", "healthy"].includes(state) ? "good" : ["unreachable", "dead", "unhealthy", "critical"].includes(state) ? "bad" : ["stopped", "paused", "restarting", "starting", "warning"].includes(state) ? "warn" : state === "info" ? "info" : "unknown";
  return <span className={`status-pill tone-${color}`}><span className="status-dot" />{stale ? "Desatualizado" : labels[state] ?? "Desconhecido"}</span>;
}
