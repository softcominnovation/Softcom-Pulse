"use client";

import { useContext } from "react";
import type { Container, Problem } from "@/lib/monitoring/contracts";
import { containerStates, healthStates, healthReasons, severities } from "@/lib/services/presentation";
import { EvidenceTimeContext } from "@/components/dashboard/metrics";
import { evidenceExpired } from "@/lib/infrastructure/navigation";
import { timestamp } from "@/lib/dashboard/format";

export function StatePill({ label, tone }: { label: string; tone: string }) {
  return <span className={`status-pill tone-${tone}`}><span className="status-dot" aria-hidden="true" />{label}</span>;
}
export function ContainerStatus({ container, stale }: { container: Container; stale: boolean }) {
  const now = useContext(EvidenceTimeContext), old = evidenceExpired(container, stale, now);
  return <span><StatePill {...containerStates[old ? "unknown" : container.status]} />{old && <small>Último estado: {containerStates[container.status].label} · evidência desatualizada</small>}</span>;
}
export function ContainerHealth({ container, stale }: { container: Container; stale: boolean }) {
  const now = useContext(EvidenceTimeContext);
  const old = stale || ("healthValidUntil" in container && (!container.healthValidUntil || Date.parse(container.healthValidUntil) < now));
  const reason = old ? healthReasons.stale : healthReasons[container.healthReason ?? "observed"];
  return <span><StatePill {...healthStates[old ? "unknown" : container.health]} />{reason && <small>{reason}</small>}<small>Health: {timestamp(container.healthObservedAt)}</small></span>;
}
export function SeverityPill({ severity }: { severity: Problem["severity"] }) {
  return <StatePill {...severities[severity]} />;
}
