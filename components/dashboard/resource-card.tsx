import { Box, Server } from "lucide-react";
import { useContext } from "react";
import type { ConfiguredResource, Metric } from "@/lib/monitoring/contracts";
import { qualityText, timestamp } from "@/lib/dashboard/format";
import { EvidenceTimeContext, MetricValue, Status } from "./metrics";
import { ServiceDetailsTrigger } from "@/components/services/service-details";
import { ContainerHealth, ContainerStatus } from "@/components/services/states";
import { affectedResource, resolutionLabel } from "@/lib/services/presentation";

export function ResourceCard({ item, stale, compact = false, details = true }: { item: ConfiguredResource; stale: boolean; compact?: boolean; details?: boolean }) {
  const now = useContext(EvidenceTimeContext);
  const { config, resource, metrics } = item, p = config.presentation;
  const container = resource && "reference" in resource ? resource : null;
  const state = resource ? "availability" in resource ? resource.availability : resource.status : "unknown";
  const evidenceOld = stale || !!resource?.evidence.validUntil && Date.parse(resource.evidence.validUntil) < now;
  const rows: { label: string; metric?: Metric; series?: "cpu" | "memory" | "disk" }[] = [];
  if (p.showCpu) rows.push({ label: "CPU", metric: metrics.cpuUsagePercent });
  if (p.showMemory) {
    rows.push({ label: "RAM usada", metric: metrics.memoryUsedBytes, series: "memory" });
    if (metrics.memoryTotalBytes) rows.push({ label: "RAM total", metric: metrics.memoryTotalBytes, series: "memory" });
    if (metrics.memoryUsagePercent) rows.push({ label: "RAM utilizada", metric: metrics.memoryUsagePercent, series: "memory" });
  }
  if (p.showDisk) {
    rows.push({ label: "Disco utilizado", metric: metrics.diskUsagePercent ?? metrics.diskUsedBytes, series: "disk" });
    if (metrics.diskTotalBytes) rows.push({ label: "Disco total", metric: metrics.diskTotalBytes, series: "disk" });
    if (metrics.diskReadBytesPerSecond) rows.push({ label: "Leitura de disco", metric: metrics.diskReadBytesPerSecond });
    if (metrics.diskWriteBytesPerSecond) rows.push({ label: "Escrita de disco", metric: metrics.diskWriteBytesPerSecond });
  }
  if (p.showNetwork) rows.push({ label: "Rede recebida", metric: metrics.networkReceiveBitsPerSecond }, { label: "Rede transmitida", metric: metrics.networkTransmitBitsPerSecond });
  if (p.showUptime) rows.push({ label: "Tempo ativo", metric: metrics.uptimeSeconds });
  return <article className={`resource-card${affectedResource(item) ? " resource-affected" : ""}`}>
    <div className="resource-top">{config.resourceType === "host" ? <Server aria-hidden="true" /> : <Box aria-hidden="true" />}<span>{config.resourceType === "host" ? "Host" : "Container"}</span>{config.critical && <span className="critical-label">Crítico para a operação</span>}</div>
    <h3>{config.displayName ?? resource?.displayName ?? resource?.name ?? config.zabbixHostKey}</h3><p className="resource-host">{config.zabbixHostKey}</p>
    {!config.enabled && <p className="resource-host">Configuração desabilitada</p>}
    {!item.resolved && <p className="resource-missing">{resolutionLabel(item)}</p>}
    <div className="resource-status">
      {p.showStatus && (container ? <ContainerStatus container={container} stale={stale} /> : <Status value={state} stale={evidenceOld} />)}
      {"showHealth" in p && Boolean(p.showHealth) && (container ? <ContainerHealth container={container} stale={stale} /> : <Status value="unknown" />)}
    </div>
    <dl className="resource-metrics">{rows.map(row => <div key={row.label}><dt>{row.label}</dt><dd><MetricValue metric={row.metric} stale={stale} series={row.series} compact={compact} /></dd></div>)}</dl>
    {compact ? <details className="resource-evidence"><summary>Evidência: {timestamp(resource?.evidence.observedAt)}</summary><dl>{rows.map(row => <div key={row.label}><dt>{row.label}</dt><dd>{qualityText(row.metric, stale, now)} · {timestamp(row.metric?.observedAt)}</dd></div>)}</dl></details> : <p className="resource-evidence">Evidência: {timestamp(resource?.evidence.observedAt)}</p>}
    {details && <div className="resource-detail-action"><ServiceDetailsTrigger item={item} /></div>}
  </article>;
}
