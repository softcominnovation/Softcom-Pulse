"use client";
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
  const now = useContext(EvidenceTimeContext), [open, setOpen] = useState(false);
  const publicSurface = isPublicPath(usePathname());
  const detail = useStorage(item.storageKey, open && !preview);
  const old = stale || item.stale, status = storageStatus({ ...item, stale: old }, now);
  const network = item.selectedInterface;
  const traffic = [
    ["RX", network?.metrics.networkReceiveBitsPerSecond],
    ["TX", network?.metrics.networkTransmitBitsPerSecond],
  ] as const;
  const uptime = item.metrics.uptimeSeconds;
  const reading = uptime && !isOld(uptime, old, now) ? `Ativo ${metricValue(uptime)}` : `Leitura ${timestamp(item.evidence.observedAt)}`;
  const content = <>
    <span className={`availability-state tone-${status.tone}`}><i className="status-dot" />{status.label}</span>
    <strong className="availability-name">{item.displayName}</strong>
    <span className="availability-description">{item.description ?? "Storage · Zabbix Agent"}</span>
    <span className="availability-readings">{([
      ["CPU", item.metrics.cpuUsagePercent], ["Disco", item.capacity.usagePercent],
    ] as const).map(([label, metric]) => <span className="availability-reading" key={label}>
      <span>{label}<strong>{metricValue(metric)}</strong></span>
      <span className={`availability-meter${label === "Disco" ? " disk" : ""}`} aria-hidden="true"><i style={{ width: metric?.quality === "fresh" && metric.value !== null && !isOld(metric, old, now) ? `${Math.max(0, Math.min(100, metric.value))}%` : "0%" }} /></span>
    </span>)}</span>
    <span className="availability-footer" title={reading}>{traffic.map(([label, metric]) => <span key={label} className={`storage-mini-traffic${isOld(metric, old, now) ? " metric-old" : ""}`} title={network ? `${network.name} · ${label}: ${metricValue(metric)} · ${qualityText(metric, old, now)} · ${timestamp(metric?.observedAt)}\n${reading}` : "Selecione a interface de rede na configuração do Storage para exibir RX/TX."}>
      {label} <strong>{metric?.value != null && ["fresh", "stale"].includes(metric.quality) ? metricValue(metric) : "—"}</strong>
    </span>)}</span>
  </>;
  if (preview) return <article className="availability-card storage-availability-card">{content}</article>;
  return <Dialog open={open} onOpenChange={setOpen}><DialogTrigger asChild><button type="button" className="availability-card storage-availability-card" aria-label={`Detalhes de ${item.displayName}: ${status.label}`}>{content}</button></DialogTrigger><DialogContent size="xl" className="storage-detail-dialog"><DialogHeader><DialogTitle>{item.displayName}</DialogTitle><DialogDescription>Capacidade e recursos do Storage monitorado.</DialogDescription></DialogHeader><DialogBody>{detail.failed && <p role="alert">A atualização falhou. A última leitura permanece identificada.</p>}<StoragePanel item={detail.data?.data ?? item} stale={detail.failed || detail.data?.stale || stale} /><PlaceLink className="panel-link" href={`${publicSurface ? "/monitor" : ""}/servicos?storage=${encodeURIComponent(item.storageKey)}#storages`}>Ver em Serviços</PlaceLink></DialogBody></DialogContent></Dialog>;
}
