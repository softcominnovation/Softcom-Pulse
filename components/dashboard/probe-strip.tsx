"use client";

import { probeStripLength } from "@/lib/config/external-services";
import { probeStatus } from "@/lib/probe/status";

export const probeLiveRefreshMs = 10_000;
const emptyFill = "#9daeb9";

function slots(reasons: number[]) {
  const points = reasons.slice(-probeStripLength);
  return Array.from({ length: probeStripLength }, (_, index) => points[index] ?? null);
}

export function ProbeStrip({ reasons, variant = "strip", colorFor = (reason: number) => probeStatus(reason).color }: { reasons: number[]; variant?: "strip" | "track"; colorFor?: (reason: number) => string }) {
  const points = slots(reasons);
  const filled = points.filter(reason => reason !== null).length;
  const width = 3, gap = 1, total = probeStripLength * (width + gap) - gap;
  const labeled = variant === "track";
  return <svg className={labeled ? "uptime-track" : "uptime-strip"} viewBox={`0 0 ${total} 8`} preserveAspectRatio="none" role={labeled ? "img" : undefined} aria-hidden={labeled ? undefined : true} aria-label={labeled ? filled ? `${filled} de ${probeStripLength} consultas registradas` : `${probeStripLength} consultas ainda sem resultado` : undefined}>
    {points.map((reason, index) => <rect key={index} x={index * (width + gap)} width={width} height="8" rx="0.6" fill={reason === null ? emptyFill : colorFor(reason)} opacity={reason === null ? 0.35 : 1} />)}
  </svg>;
}

export function UptimeTrack({ reasons }: { reasons: number[] }) {
  return <ProbeStrip reasons={reasons} variant="track" />;
}
