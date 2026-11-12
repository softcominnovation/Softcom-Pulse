"use client";
import { useIncidentAttributes } from "@/components/notifications/incident-highlight";
import { AvailabilityCardHeader } from "@/components/dashboard/availability-card-header";
import { CardReadings } from "@/components/dashboard/card-readings";
import { currentMetric } from "@/lib/dashboard/service-availability";
import { useContext, useState } from "react";
import { usePathname } from "next/navigation";
import { PlaceLink } from "@/components/layout/place-link";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { EvidenceTimeContext } from "@/components/dashboard/metrics";
import { metricValue, isOld, qualityText, timestamp } from "@/lib/dashboard/format";
import { isPublicPath } from "@/lib/public/paths";
import type { StorageView } from "@/lib/storage/contracts";
import { storageStatus } from "@/lib/storage/presentation";
import { StoragePanel } from "./storage-panel";
import { useStorage } from "./data";

export function StorageCard({ item, stale = false, preview = false }: { item: StorageView; stale?: boolean; preview?: boolean }) {
  const incident = useIncidentAttributes();
  const now = useContext(EvidenceTimeContext), [open, setOpen] = useState(false);
  const publicSurface = isPublicPath(usePathname());
  const detail = useStorage(item.storageKey, open && !preview);
  const old = stale || item.stale, status = storageStatus({ ...item, stale: old }, now);
  const pair = item.cardMetrics ?? ["cpu", "disk"];
  const metrics = { cpu: item.metrics.cpuUsagePercent, memory: item.metrics.memoryUsagePercent, disk: item.capacity.usagePercent };
  const values = Object.fromEntries(Object.entries(metrics).map(([key, metric]) => [key, currentMetric(metric, old, now) && metric?.unit === "percent" ? metric.value : null])) as Record<"cpu" | "memory" | "disk", number | null>;
  const network = item.selectedInterface;
  const traffic = [
    ["RX", network?.metrics.networkReceiveBitsPerSecond],
    ["TX", network?.metrics.networkTransmitBitsPerSecond],
  ] as const;
  const uptime = item.metrics.uptimeSeconds;
  const reading = uptime && !isOld(uptime, old, now) ? `Ativo ${metricValue(uptime)}` : `Leitura ${timestamp(item.evidence.observedAt)}`;
  const content = <>
    <AvailabilityCardHeader name={item.displayName} label={status.label} tone={status.tone} />
    <span className="availability-description">{item.description ?? "Storage · Zabbix Agent"}</span>
    <CardReadings pair={pair} values={values} diskTitle={item.capacity.label} />
    <span className="availability-footer" title={reading}>{traffic.map(([label, metric]) => <span key={label} className={`storage-mini-traffic${isOld(metric, old, now) ? " metric-old" : ""}`} title={network ? `${network.name} · ${label}: ${metricValue(metric)} · ${qualityText(metric, old, now)} · ${timestamp(metric?.observedAt)}\n${reading}` : "Selecione a interface de rede na configuração do Storage para exibir RX/TX."}>
      {label} <strong>{metric?.value != null && ["fresh", "stale"].includes(metric.quality) ? metricValue(metric) : "—"}</strong>
    </span>)}</span>
  </>;
  if (preview) return <article className="availability-card storage-availability-card" data-metric-count={pair.length}>{content}</article>;
  return <Dialog open={open} onOpenChange={setOpen}><DialogTrigger asChild><button {...incident("storage", item.configId)} type="button" className="availability-card storage-availability-card" data-metric-count={pair.length} aria-label={`Detalhes de ${item.displayName}: ${status.label}`}>{content}</button></DialogTrigger><DialogContent size="xl" className="storage-detail-dialog"><DialogHeader><DialogTitle>{item.displayName}</DialogTitle><DialogDescription>Capacidade e recursos do Storage monitorado.</DialogDescription></DialogHeader><DialogBody>{detail.failed && <p role="alert">A atualização falhou. A última leitura permanece identificada.</p>}<StoragePanel item={detail.data?.data ?? item} stale={detail.failed || detail.data?.stale || stale} /><PlaceLink className="panel-link" href={`${publicSurface ? "/monitor" : ""}/servicos?storage=${encodeURIComponent(item.storageKey)}#storages`}>Ver em Serviços</PlaceLink></DialogBody></DialogContent></Dialog>;
}
