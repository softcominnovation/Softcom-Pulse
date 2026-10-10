"use client";

import { PlaceLink } from "@/components/layout/place-link";
import type { ReactElement } from "react";
import { timestamp } from "@/lib/dashboard/format";
import { signalStateColor, signalStateLabel, signalStateTone, signalWorkersLabel } from "@/lib/signal/labels";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { ProbeStrip } from "./probe-strip";
import { signalStripLength } from "@/lib/config/signal-targets";

export type SignalCardItem = {
  id: string;
  displayName: string;
  description: string | null;
  enabled?: boolean;
  state: number;
  latencyMs: number | null;
  activeInstances: number | null;
  strip: number[];
  checkedAt: string | null;
  readyStatus?: string | null;
  workerStatus?: string | null;
};

function uptimeLabel(strip: number[]) {
  const points = strip.slice(-signalStripLength);
  if (!points.length) return "—";
  const ok = points.filter(state => state === 0).length;
  return `${Math.round((ok / points.length) * 100)}%`;
}

export function SignalAvailabilityCard({ item }: { item: SignalCardItem }) {
  const paused = item.enabled === false;
  const label = paused ? "Pausado" : signalStateLabel(item.state);
  const tone = paused ? "unknown" : signalStateTone(item.state);
  const workers = paused ? "Fora da coleta" : signalWorkersLabel(item.activeInstances, item.checkedAt);
  const strip = paused ? [] : item.strip;
  const content = <>
    <span className={`availability-state tone-${tone}`}><i className="status-dot" />{label}</span>
    <strong className="availability-name">{item.displayName}</strong>
    <span className="availability-description">{item.description?.trim() || "Signal"}</span>
    <span className="probe-card-uptime">
      <ProbeStrip reasons={strip} colorFor={signalStateColor} />
      <span className="availability-footer">
        <span>{workers}{!paused && item.latencyMs !== null ? ` · ${item.latencyMs} ms` : ""}</span>
        <strong>{paused ? "—" : uptimeLabel(item.strip)}</strong>
      </span>
    </span>
  </>;
  return <SignalDetails item={item} trigger={<button type="button" className="availability-card probe-card signal-card-highlight" aria-label={`Detalhes de ${item.displayName}: ${label}`}>{content}</button>} />;
}

function SignalDetails({ item, trigger }: { item: SignalCardItem; trigger: ReactElement }) {
  const label = signalStateLabel(item.state);
  const tone = signalStateTone(item.state);
  return <Dialog><DialogTrigger asChild>{trigger}</DialogTrigger><DialogContent className="probe-dialog"><DialogHeader>
    <DialogTitle><span className={`app-presence tone-${tone}`}>{label}</span> {item.displayName}</DialogTitle>
    <DialogDescription>{item.description?.trim() || "Softcom Signal"}{item.readyStatus ? ` · ready ${item.readyStatus}` : ""}{item.workerStatus ? ` · worker ${item.workerStatus}` : ""}</DialogDescription>
    <PlaceLink className="probe-admin-link" href="/servicos#signal">Abrir em Serviços</PlaceLink>
  </DialogHeader><DialogBody>
    <p className="app-monitor-meta">{signalWorkersLabel(item.activeInstances, item.checkedAt)}{item.latencyMs !== null ? ` · latência ${item.latencyMs} ms` : ""}{item.checkedAt ? ` · ${timestamp(item.checkedAt)}` : ""}</p>
    <ProbeStrip reasons={item.strip} variant="track" colorFor={signalStateColor} />
  </DialogBody></DialogContent></Dialog>;
}
