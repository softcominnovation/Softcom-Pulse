import type { ConfiguredResource, Metric } from "../monitoring/contracts.ts";
import { isOld } from "./format.ts";
import { evidenceExpired } from "../infrastructure/navigation.ts";

export const serviceLoadThreshold = 90;
export function currentMetric(metric: Metric | undefined, stale: boolean, now: number) {
  return !!metric && metric.value !== null && metric.quality === "fresh" && !!metric.observedAt && !isOld(metric, stale, now);
}
export function serviceAvailability(item: ConfiguredResource, stale: boolean, now: number) {
  const target = item.resource;
  if (!item.config.enabled) return { label: "Desabilitado", tone: "unknown" };
  if (!item.resolved || !target) return { label: item.resolution === "ambiguous" ? "Ambíguo" : "Sem dados", tone: "unknown" };
  if (!item.config.presentation.showStatus) return { label: "Estado oculto", tone: "unknown" };
  if (evidenceExpired(target, stale, now)) return { label: "Desatualizado", tone: "unknown" };
  const state = "reference" in target ? target.status : target.availability;
  if (["stopped", "dead", "unreachable"].includes(state)) return { label: "Indisponível", tone: "bad" };
  if (state !== "running" && state !== "reachable") return { label: state === "paused" ? "Pausado" : state === "restarting" ? "Reiniciando" : state === "removing" ? "Em remoção" : state === "created" ? "Criado" : "Sem estado", tone: "unknown" };
  const { cpuUsagePercent: cpu, memoryUsagePercent: ram } = item.metrics;
  const busy = cpu?.unit === "percent" && ram?.unit === "percent" && currentMetric(cpu, stale, now) && currentMetric(ram, stale, now) && cpu.value! >= serviceLoadThreshold && ram.value! >= serviceLoadThreshold;
  return { label: busy ? "Atenção" : "Disponível", tone: busy ? "warn" : "good" };
}
