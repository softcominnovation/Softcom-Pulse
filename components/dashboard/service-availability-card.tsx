"use client";
import { AvailabilityCardHeader } from "@/components/dashboard/availability-card-header";
import { useContext } from "react";
import type { ConfiguredResource, Metric } from "@/lib/monitoring/contracts";
import { currentMetric, serviceAvailability } from "@/lib/dashboard/service-availability";
import { availabilityCardSlots } from "@/lib/monitoring/card-metrics";
import { cardMetricOrder } from "@/lib/config/agent-monitoring";
import { metricValue, timestamp } from "@/lib/dashboard/format";
import { EvidenceTimeContext } from "./metrics";
import { ServiceDetailsTrigger } from "@/components/services/service-details";

function meterClass(label: string) {
  return label === "RAM" ? "availability-meter memory" : label === "Disco" ? "availability-meter disk" : "availability-meter";
}

function Reading({ label, metric, stale, now, title, currentOnly = false }: { label: string; metric?: Metric; stale: boolean; now: number; title?: string; currentOnly?: boolean }) {
  const valid = currentMetric(metric, stale, now) && (!currentOnly || metric?.unit === "percent");
  return <span className="availability-reading" data-usage-percent={currentOnly || metric?.unit === "percent" || undefined} title={title ? `${title}${valid ? "" : " · Sem leitura atual"}` : undefined}><span>{label}<strong>{currentOnly && !valid ? "—" : metricValue(metric)}</strong></span><span className={meterClass(label)} aria-hidden="true"><i style={{ width: valid && metric?.unit === "percent" ? Math.max(0, Math.min(100, metric.value!)) + "%" : "0%" }} /></span></span>;
}
export function ServiceAvailabilityCard({ item, stale, preview = false }: { item: ConfiguredResource; stale: boolean; preview?: boolean }) {
  const now = useContext(EvidenceTimeContext), status = serviceAvailability(item, stale, now);
  const name = item.config.displayName ?? item.resource?.displayName ?? item.resource?.name ?? item.config.zabbixHostKey;
  const p = item.config.presentation;
  const slots = availabilityCardSlots(p, item.config.resourceType);
  const uptime = item.metrics.uptimeSeconds;
  const footer = p.showUptime && currentMetric(uptime, stale, now) ? `Ativo ${metricValue(uptime)}` : item.resource?.evidence.observedAt ? `Leitura ${timestamp(item.resource.evidence.observedAt).split(", ").at(-1)}` : "Sem leitura";
  const content = <>
    <AvailabilityCardHeader name={name} label={status.label} tone={status.tone} />
    <span className="availability-description">{item.config.description?.trim() || item.linkedVmName || item.config.zabbixHostKey}</span>
    <span className="availability-readings" data-metric-count={slots.length}>{slots.length ? cardMetricOrder(slots).map(kind => <Reading key={kind} label={kind === "cpu" ? "CPU" : kind === "memory" ? "RAM" : "Disco"} metric={kind === "cpu" ? item.metrics.cpuUsagePercent : kind === "memory" ? item.metrics.memoryUsagePercent ?? (p.cardMetrics ? undefined : item.metrics.memoryUsedBytes) : item.metrics.diskUsagePercent} stale={stale} now={now} currentOnly={!!p.cardMetrics || kind === "disk"} title={kind === "disk" ? item.cardDiskLabel ?? "Disco do recurso" : undefined} />) : <span className="availability-no-metrics">Ver detalhes</span>}</span>

    <span className="availability-footer"><span>{item.config.serviceType ?? (item.config.resourceType === "host" ? (item.resource && !("reference" in item.resource) && item.resource.role === "linux" ? "Host · Agent" : "Host") : "Container")}</span><strong>{footer}</strong></span>
  </>;
  return preview ? <article className="availability-card" data-metric-count={slots.length}>{content}</article> : <ServiceDetailsTrigger item={item} trigger={<button type="button" className="availability-card" data-metric-count={slots.length} aria-label={`Detalhes de ${name}: ${status.label}`}>{content}</button>} />;
}
