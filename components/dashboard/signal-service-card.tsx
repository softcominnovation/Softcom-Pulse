"use client";

import type { SignalServiceCard } from "@/lib/monitoring/contracts";
import { PlaceLink } from "@/components/layout/place-link";

export function SignalServiceAvailabilityCard({ item }: { item: SignalServiceCard }) {
  const href = `/servicos?signalTarget=${item.targetId}&signalService=${item.id}#signal`;
  const cpu = item.cpu == null ? "—" : `${Math.round(item.cpu)}%`;
  const memory = item.memory == null ? "—" : `${Math.round(item.memory)}%`;
  const uptime = item.uptimeSeconds == null ? "—" : item.uptimeSeconds >= 3600 ? `${Math.floor(item.uptimeSeconds / 3600)} h` : `${Math.floor(item.uptimeSeconds / 60)} min`;
  return <PlaceLink className="availability-card" href={href} aria-label={`${item.displayName}, ${item.kpiLabel}`}>
    <span className={`availability-state tone-${item.tone}`}><i className="status-dot" />{item.kpiLabel}</span>
    <strong className="availability-name">{item.displayName}</strong>
    <span className="availability-description">{item.servicePrefix}</span>
    <span className="availability-readings">
      <span className="availability-reading"><span>CPU<strong>{cpu}</strong></span><span className="availability-meter" aria-hidden="true"><i style={{ width: item.cpu == null ? "0%" : `${Math.max(0, Math.min(100, item.cpu))}%` }} /></span></span>
      <span className="availability-reading"><span>RAM<strong>{memory}</strong></span><span className="availability-meter memory" aria-hidden="true"><i style={{ width: item.memory == null ? "0%" : `${Math.max(0, Math.min(100, item.memory))}%` }} /></span></span>
    </span>
    <span className="availability-footer"><span>{item.vmName ?? item.hostKey ?? "Cluster"}</span><strong>{uptime}</strong></span>
  </PlaceLink>;
}
