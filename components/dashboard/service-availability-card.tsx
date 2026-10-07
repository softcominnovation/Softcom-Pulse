"use client";

import { useContext } from "react";
import type { ConfiguredResource, Metric } from "@/lib/monitoring/contracts";
import { currentMetric, serviceAvailability } from "@/lib/dashboard/service-availability";
import { metricValue, timestamp } from "@/lib/dashboard/format";
import { EvidenceTimeContext } from "./metrics";
import { ServiceDetailsTrigger } from "@/components/services/service-details";

function Reading({ label, metric, stale, now }: { label: string; metric?: Metric; stale: boolean; now: number }) {
  const valid = currentMetric(metric, stale, now);
  return <span className="availability-reading"><span>{label}<strong>{valid ? metricValue(metric) : "—"}</strong></span><span className={label === "RAM" ? "availability-meter memory" : "availability-meter"} aria-hidden="true"><i style={{ width: valid && metric?.unit === "percent" ? Math.max(0, Math.min(100, metric.value!)) + "%" : "0%" }} /></span></span>;
}
export function ServiceAvailabilityCard({ item, stale, preview = false }: { item: ConfiguredResource; stale: boolean; preview?: boolean }) {
  const now = useContext(EvidenceTimeContext), status = serviceAvailability(item, stale, now);
  const name = item.config.displayName ?? item.resource?.displayName ?? item.resource?.name ?? item.config.zabbixHostKey;
  const p = item.config.presentation;
  const uptime = item.metrics.uptimeSeconds;
  const footer = p.showUptime && currentMetric(uptime, stale, now) ? `Ativo ${metricValue(uptime)}` : item.resource?.evidence.observedAt ? `Leitura ${timestamp(item.resource.evidence.observedAt).split(", ").at(-1)}` : "Sem leitura";
  const content = <>
    <span className={`availability-state tone-${status.tone}`}><i className="status-dot" />{status.label}</span>
    <strong className="availability-name">{name}</strong>
    <span className="availability-description">{item.config.description?.trim() || item.linkedVmName || item.config.zabbixHostKey}</span>
    <span className="availability-readings">{p.showCpu && <Reading label="CPU" metric={item.metrics.cpuUsagePercent} stale={stale} now={now} />}{p.showMemory && <Reading label="RAM" metric={item.metrics.memoryUsagePercent ?? item.metrics.memoryUsedBytes} stale={stale} now={now} />}{!p.showCpu && !p.showMemory && <span className="availability-no-metrics">Ver detalhes</span>}</span>
    <span className="availability-footer"><span>{item.config.serviceType ?? (item.config.resourceType === "host" ? "Host" : "Container")}</span><strong>{footer}</strong></span>
  </>;
  return preview ? <article className="availability-card">{content}</article> : <ServiceDetailsTrigger item={item} trigger={<button type="button" className="availability-card" aria-label={`Detalhes de ${name}: ${status.label}`}>{content}</button>} />;
}
