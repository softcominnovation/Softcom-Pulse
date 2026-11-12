"use client";
import { useIncidentAttributes } from "@/components/notifications/incident-highlight";
import { AvailabilityCardHeader } from "@/components/dashboard/availability-card-header";
import { CardReadings } from "./card-readings";

import type { SignalServiceCard } from "@/lib/monitoring/contracts";
import { PlaceLink } from "@/components/layout/place-link";

export function SignalServiceAvailabilityCard({ item }: { item: SignalServiceCard }) {
  const incident = useIncidentAttributes();
  const href = `/servicos?signalTarget=${item.targetId}&signalService=${item.id}#signal`;
  const uptime = item.uptimeSeconds == null ? "—" : item.uptimeSeconds >= 3600 ? `${Math.floor(item.uptimeSeconds / 3600)} h` : `${Math.floor(item.uptimeSeconds / 60)} min`;
  return <PlaceLink {...incident("signal_service", item.id)} className="availability-card" data-metric-count={item.cardMetrics?.length} href={href} aria-label={`${item.displayName}, ${item.kpiLabel}`}>
    <AvailabilityCardHeader name={item.displayName} label={item.kpiLabel} tone={item.tone} />
    <span className="availability-description">{item.servicePrefix}</span>
    <CardReadings pair={item.cardMetrics ?? ["cpu", "memory"]} values={{ cpu: item.cpu, memory: item.memory, disk: item.disk ?? null }} diskLabel="Disco da VM" />
    <span className="availability-footer"><span>{item.vmName ?? item.hostKey ?? "Cluster"}</span><strong>{uptime}</strong></span>
  </PlaceLink>;
}
