import type { ProbeCard } from "@/lib/monitoring/contracts";

export function probePresence(reason: number | null) {
  if (reason === null) return { label: "Sem dados", tone: "unknown" as const };
  if (reason <= 1) return { label: "No ar", tone: "good" as const };
  return { label: "Fora do ar", tone: "bad" as const };
}
export function probeStatus(reason: number | null) {
  if (reason === null) return { label: "Sem dados", tone: "unknown" as const, color: "#9daeb9" };
  if (reason === 0) return { label: "Disponível", tone: "good" as const, color: "#64d6b0" };
  if (reason === 1) return { label: "Lento", tone: "warn" as const, color: "#f2c275" };
  if (reason === 2) return { label: "Falha na consulta", tone: "warn" as const, color: "#f2c275" };
  return { label: "Indisponível", tone: "bad" as const, color: "#ff8585" };
}
export function uptimePercent(uptime: { available: number; total: number } | null) {
  if (!uptime || uptime.total <= 0) return null;
  return (uptime.available / uptime.total) * 100;
}
export function formatUptime(uptime: { available: number; total: number } | null) {
  const value = uptimePercent(uptime);
  return value === null ? "—" : `${value.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`;
}
export function formatLatency(ms: number | null) {
  return ms === null ? "sem resposta" : `${Math.round(ms).toLocaleString("pt-BR")} ms`;
}
export function certRemainingDays(certNotAfter: string | null, now = Date.now()) {
  if (!certNotAfter) return null;
  const end = Date.parse(certNotAfter);
  if (!Number.isFinite(end)) return null;
  return Math.ceil((end - now) / 86400000);
}
export function sortProbeCards(items: ProbeCard[], sortBy: "name" | "uptime" | "state", direction: "asc" | "desc") {
  const factor = direction === "desc" ? -1 : 1;
  return [...items].sort((a, b) => {
    const name = a.displayName.localeCompare(b.displayName, "pt");
    if (sortBy === "name") return name * factor || name;
    if (sortBy === "uptime") {
      const left = uptimePercent(a.uptime24h), right = uptimePercent(b.uptime24h);
      if (left === null || right === null) return left === right ? name : left === null ? 1 : -1;
      return (left - right) * factor || name;
    }
    if (a.reason === null || b.reason === null) return a.reason === b.reason ? name : a.reason === null ? 1 : -1;
    return (a.reason - b.reason) * factor || name;
  });
}
