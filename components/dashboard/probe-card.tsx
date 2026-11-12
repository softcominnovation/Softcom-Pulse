"use client";
import { useIncidentAttributes } from "@/components/notifications/incident-highlight";
import { AvailabilityCardHeader } from "@/components/dashboard/availability-card-header";

import type { ProbeCard } from "@/lib/monitoring/contracts";
import { formatLatency, formatUptime, probeStatus } from "@/lib/probe/status";
import { ProbeDetails } from "./probe-details";
import { ProbeStrip } from "./probe-strip";

export function ProbeAvailabilityCard({ item }: { item: ProbeCard }) {
  const incident = useIncidentAttributes();
  const status = item.paused ? { label: "Pausado", tone: "unknown" as const } : probeStatus(item.reason);
  const uptime = formatUptime(item.uptime24h);
  const content = <>
    <AvailabilityCardHeader name={item.displayName} label={status.label} tone={status.tone} />
    <span className="availability-description">{item.description?.trim() || item.serviceType?.trim() || "Aplicação"}</span>
    <span className="probe-card-uptime"><ProbeStrip reasons={item.paused ? [] : item.strip} /><span className="availability-footer"><span>{item.serviceType?.trim() || "Aplicação"} · {formatLatency(item.latencyMs)}</span><strong>{uptime}</strong></span></span>
  </>;
  return <ProbeDetails item={item} trigger={<button {...incident("external_service", item.id)} type="button" className="availability-card probe-card" aria-label={`Detalhes de ${item.displayName}: ${status.label}, disponibilidade ${uptime}`}>{content}</button>} />;
}
