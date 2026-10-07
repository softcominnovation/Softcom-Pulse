"use client";

import type { ProbeCard } from "@/lib/monitoring/contracts";
import { formatLatency, formatUptime, probeStatus } from "@/lib/probe/status";
import { ProbeDetails } from "./probe-details";
import { ProbeStrip } from "./probe-strip";

export function ProbeAvailabilityCard({ item }: { item: ProbeCard }) {
  const status = item.paused ? { label: "Pausado", tone: "unknown" as const } : probeStatus(item.reason);
  const uptime = formatUptime(item.uptime24h);
  const content = <>
    <span className={`availability-state tone-${status.tone}`}><i className="status-dot" />{status.label}</span>
    <strong className="availability-name">{item.displayName}</strong>
    <span className="availability-description">{item.description?.trim() || item.serviceType?.trim() || "Aplicação"}</span>
    <span className="probe-card-uptime"><ProbeStrip reasons={item.paused ? [] : item.strip} /><span className="availability-footer"><span>{item.serviceType?.trim() || "Aplicação"} · {formatLatency(item.latencyMs)}</span><strong>{uptime}</strong></span></span>
  </>;
  return <ProbeDetails item={item} trigger={<button type="button" className="availability-card probe-card" aria-label={`Detalhes de ${item.displayName}: ${status.label}, disponibilidade ${uptime}`}>{content}</button>} />;
}
