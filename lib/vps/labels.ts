import type { MonitorState } from "@/lib/config/standalone-vps";

export function vpsReasonColor(reason: number) {
  if (reason === 0 || reason === 4) return "#64d6b0";
  if (reason === 1) return "#f2c275";
  return "#ff8585";
}
export function vpsAvailability(enabled: boolean) {
  return enabled ? { label: "Disponível", tone: "good" as const } : { label: "Inativa", tone: "unknown" as const };
}
export function vpsMonitorLabel(state: MonitorState) {
  if (state === "not_configured") return { label: "Monitor não cadastrado", tone: "unknown" as const };
  if (state === "pending") return { label: "Aguardando consulta", tone: "unknown" as const };
  if (state === "up") return { label: "Disponível", tone: "good" as const };
  if (state === "down") return { label: "Fora do ar", tone: "bad" as const };
  if (state === "paused") return { label: "Pausado", tone: "unknown" as const };
  return null;
}
export function vpsStrip(enabled: boolean, monitorConfigured: boolean, strip: number[], paused = false) {
  return enabled && monitorConfigured && !paused ? strip : [];
}
export function vpsUptimeLabel(strip: number[]) {
  if (!strip.length) return "—";
  const available = strip.filter(reason => reason === 0 || reason === 1 || reason === 4).length;
  const value = (available / strip.length) * 100;
  return `${value.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`;
}
