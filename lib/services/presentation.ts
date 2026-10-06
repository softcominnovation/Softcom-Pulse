import type { ResourceConfig } from "../config/resources.ts";
import type { ConfiguredResource, Container, Problem } from "../monitoring/contracts.ts";

export const containerStates: Record<Container["status"], { label: string; tone: string }> = {
  running: { label: "Em execução", tone: "good" }, stopped: { label: "Parado", tone: "bad" },
  paused: { label: "Pausado", tone: "warn" }, restarting: { label: "Reiniciando", tone: "warn" },
  created: { label: "Criado", tone: "unknown" }, removing: { label: "Em remoção", tone: "warn" },
  dead: { label: "Encerrado com falha", tone: "bad" }, unknown: { label: "Sem estado atual", tone: "unknown" },
};
export const healthStates: Record<Container["health"], { label: string; tone: string }> = {
  healthy: { label: "Saudável", tone: "good" }, starting: { label: "Iniciando", tone: "warn" },
  unhealthy: { label: "Falha no healthcheck", tone: "bad" }, not_configured: { label: "Sem healthcheck", tone: "unknown" },
  unknown: { label: "Health desconhecido", tone: "unknown" },
};
export const healthReasons = { observed: "", missing: "Healthcheck não informado pela origem", unsupported: "Métrica de health não suportada", stale: "Evidência de health desatualizada", unrecognized: "Health sem mapeamento comprovado" };
export const severities: Record<Problem["severity"], { label: string; tone: string }> = {
  0: { label: "Não classificado", tone: "unknown" }, 1: { label: "Informação", tone: "info" },
  2: { label: "Atenção", tone: "warn" }, 3: { label: "Média", tone: "warn" },
  4: { label: "Alta", tone: "bad" }, 5: { label: "Desastre", tone: "bad" },
};
export function visibleMetric(key: string, p: ResourceConfig["presentation"]) {
  const leaf = key.split(".").at(-1)!;
  if (leaf.startsWith("cpu") || leaf === "osCpuCount" || leaf === "provisionedCpuCount") return p.showCpu;
  if (leaf.startsWith("memory")) return p.showMemory;
  if (leaf.startsWith("disk")) return p.showDisk;
  if (leaf.startsWith("network")) return p.showNetwork;
  return leaf === "uptimeSeconds" ? p.showUptime : leaf === "restartCount";
}
export function affectedResource(item: ConfiguredResource) {
  if (!item.config.critical) return false;
  if (!item.resolved) return true;
  const resource = item.resource;
  const p = item.config.presentation;
  return resource && ("reference" in resource ? p.showStatus && resource.status !== "running" || "showHealth" in p && p.showHealth && resource.health === "unhealthy" : p.showStatus && resource.availability === "unreachable");
}
export function resolutionLabel(item: ConfiguredResource) {
  return item.resolution === "ambiguous" ? "Mais de um recurso corresponde ao seletor" : "Recurso não encontrado na coleta atual";
}
