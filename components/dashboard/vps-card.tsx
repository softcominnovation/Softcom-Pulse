"use client";

import { PlaceLink } from "@/components/layout/place-link";
import type { ReactElement } from "react";
import type { StandaloneVpsHighlight } from "@/lib/config/standalone-vps";
import { timestamp } from "@/lib/dashboard/format";
import { vpsAvailability, vpsMonitorLabel, vpsReasonColor, vpsStrip, vpsUptimeLabel } from "@/lib/vps/labels";
import { useVpsSelectionStore } from "@/store/vps-selection.store";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { ProbeStrip } from "./probe-strip";

function percentLabel(value: number | null) {
  return value === null ? "—" : `${value.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`;
}
function hasReading(item: StandaloneVpsHighlight) {
  return item.enabled && item.monitorConfigured && !item.monitorPaused && (item.cpuPercent !== null || item.memoryPercent !== null || item.diskPercent !== null);
}
function SnapshotMeter({ series, label, value }: { series: "cpu" | "memory" | "disk"; label: string; value: number | null }) {
  const width = value === null ? 0 : Math.max(0, Math.min(100, value));
  return <div className={`series-${series}`}><span>{label}</span><strong>{percentLabel(value)}</strong><svg className={`metric-meter series-${series}`} viewBox="0 0 100 4" preserveAspectRatio="none" aria-hidden="true"><rect width="100" height="4" rx="2" className="meter-track" />{value !== null && <rect width={width} height="4" rx="2" className="meter-value" />}</svg></div>;
}
export function VpsAvailabilityCard({ item }: { item: StandaloneVpsHighlight }) {
  const availability = vpsAvailability(item.enabled);
  const monitor = vpsMonitorLabel(item.monitorState);
  const headline = item.enabled ? monitor?.label ?? availability.label : availability.label;
  const strip = vpsStrip(item.enabled, item.monitorConfigured, item.strip, item.monitorPaused);
  const uptime = vpsUptimeLabel(strip);
  const content = <>
    <span className={`availability-state tone-${item.enabled ? monitor?.tone ?? "good" : "unknown"}`}><i className="status-dot" />{headline}</span>
    <strong className="availability-name">{item.name}</strong>
    <span className="availability-description">{item.provider?.trim() || item.ip}</span>
    <span className="probe-card-uptime"><ProbeStrip reasons={strip} colorFor={vpsReasonColor} /><span className="availability-footer"><span>VPS · {item.ip}</span><strong>{uptime}</strong></span></span>
  </>;
  return <VpsDetails item={item} trigger={<button type="button" className="availability-card probe-card vps-card-highlight" aria-label={`Detalhes de ${item.name}: ${headline}, disponibilidade ${uptime}`}>{content}</button>} />;
}
function VpsDetails({ item, trigger }: { item: StandaloneVpsHighlight; trigger: ReactElement }) {
  const availability = vpsAvailability(item.enabled);
  const monitor = vpsMonitorLabel(item.monitorState);
  return <Dialog><DialogTrigger asChild>{trigger}</DialogTrigger><DialogContent className="probe-dialog"><DialogHeader>
    <DialogTitle><span className={`app-presence tone-${availability.tone}`}>{availability.label}</span> {item.name}</DialogTitle>
    <DialogDescription>{item.ip}{monitor ? ` · ${monitor.label}` : ""}</DialogDescription>
    <PlaceLink className="probe-admin-link" href={`/admin/vps/${item.id}`} onClick={() => useVpsSelectionStore.getState().select(item.id)}>Abrir em VPS</PlaceLink>
  </DialogHeader><DialogBody>
    {hasReading(item) && <div className="vps-snapshot" aria-label="Recursos"><SnapshotMeter series="cpu" label="CPU" value={item.cpuPercent} /><SnapshotMeter series="memory" label="RAM" value={item.memoryPercent} /><SnapshotMeter series="disk" label="Disco" value={item.diskPercent} /></div>}
    {item.checkedAt && item.monitorConfigured && <p className="app-monitor-meta">Última leitura {timestamp(item.checkedAt)}</p>}
    <ProbeStrip reasons={vpsStrip(item.enabled, item.monitorConfigured, item.strip, item.monitorPaused)} variant="track" colorFor={vpsReasonColor} />
  </DialogBody></DialogContent></Dialog>;
}
