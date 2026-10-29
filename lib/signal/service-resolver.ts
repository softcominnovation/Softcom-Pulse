import { compileSelector } from "../monitoring/selectors.ts";

export type ServiceContainerStatus = "running" | "stopped" | "paused" | "restarting" | "created" | "removing" | "dead" | "unknown";
export type ServiceContainerHealth = "healthy" | "unhealthy" | "starting" | "not_configured" | "unknown";
export type ServiceKpiLabel = "No ar" | "Atualizando" | "Atenção" | "Fora" | "Sem leitura";

export type ServiceScopeLink = { hostKey: string; vmKey: string | null; parentHostKey: string | null };
export type ServiceScopeVm = { parentHostKey: string; vmKey: string; linuxHostKey: string | null };
export type ServiceScopeHost = {
  hostKey: string;
  role: "hypervisor" | "linux" | "unknown";
  disabled: boolean;
  readable: boolean;
};
export type ServiceObservedContainer = {
  hostKey: string;
  name: string;
  status: ServiceContainerStatus;
  statusFresh: boolean;
  health: ServiceContainerHealth;
  healthFresh: boolean;
  cpu: number | null;
  memory: number | null;
  uptimeSeconds: number | null;
};
export type ServiceHostCoverage = { hostKey: string; complete: boolean; fresh: boolean; names: string[] };

export type SignalServiceResolution = {
  resolution: "selected" | "down" | "unknown" | "ambiguous" | "suppressed";
  reason: string;
  complete: boolean;
  hostKeys: string[];
  candidate: ServiceObservedContainer | null;
  candidateCount: number;
  runningCount: number;
  statusState: "healthy" | "unavailable" | "attention" | "unknown" | "suppressed";
  healthState: "healthy" | "unavailable" | "unknown";
  tone: "good" | "warn" | "bad" | "unknown";
  kpiLabel: ServiceKpiLabel;
  healthNote: string | null;
};

const empty = (reason: string, resolution: SignalServiceResolution["resolution"], hostKeys: string[] = []): SignalServiceResolution => ({
  resolution, reason, complete: false, hostKeys, candidate: null, candidateCount: 0, runningCount: 0,
  statusState: resolution === "suppressed" ? "suppressed" : resolution === "down" ? "unavailable" : "unknown",
  healthState: "unknown",
  tone: "unknown",
  kpiLabel: resolution === "down" ? "Fora" : "Sem leitura",
  healthNote: null,
});

function kpi(candidate: ServiceObservedContainer | null, down: boolean): Pick<SignalServiceResolution, "tone" | "kpiLabel" | "statusState" | "healthState" | "healthNote"> {
  if (!candidate) return down
    ? { tone: "bad", kpiLabel: "Fora", statusState: "unavailable", healthState: "unknown", healthNote: null }
    : { tone: "unknown", kpiLabel: "Sem leitura", statusState: "unknown", healthState: "unknown", healthNote: null };
  const health = candidate.healthFresh ? candidate.health : "unknown";
  if (candidate.status === "restarting" || health === "starting") return { tone: "warn", kpiLabel: "Atualizando", statusState: "attention", healthState: health === "starting" ? "unknown" : health === "healthy" ? "healthy" : health === "unhealthy" ? "unavailable" : "unknown", healthNote: null };
  if (candidate.status === "paused") return { tone: "warn", kpiLabel: "Atenção", statusState: "attention", healthState: "unknown", healthNote: null };
  if (health === "unhealthy" || candidate.status === "stopped" || candidate.status === "dead") {
    return { tone: "bad", kpiLabel: "Fora", statusState: candidate.status === "running" ? "healthy" : "unavailable", healthState: health === "unhealthy" ? "unavailable" : "unknown", healthNote: null };
  }
  if (candidate.status === "running" && (health === "healthy" || health === "not_configured" || health === "unknown")) {
    return {
      tone: "good", kpiLabel: "No ar", statusState: "healthy", healthState: health === "healthy" ? "healthy" : "unknown",
      healthNote: health === "not_configured" ? "Processo no ar, sem healthcheck." : null,
    };
  }
  return { tone: "unknown", kpiLabel: "Sem leitura", statusState: "unknown", healthState: "unknown", healthNote: null };
}

export function resolveSignalService(input: {
  servicePrefix: string;
  links: ServiceScopeLink[];
  vms: ServiceScopeVm[];
  hosts: ServiceScopeHost[];
  containers: ServiceObservedContainer[];
  coverage: ServiceHostCoverage[];
}): SignalServiceResolution {
  if (!input.links.length) return empty("no_scope", "unknown");
  const agents: { hostKey: string; disabled: boolean }[] = [];
  for (const link of input.links) {
    const hostKey = link.vmKey
      ? input.vms.find(vm => vm.parentHostKey === (link.parentHostKey ?? link.hostKey) && vm.vmKey === link.vmKey)?.linuxHostKey ?? null
      : link.hostKey;
    const host = hostKey ? input.hosts.find(item => item.hostKey === hostKey) : undefined;
    if (!host || !host.readable || host.role !== "linux" || (link.vmKey && !hostKey)) return empty("incomplete_scope", "unknown");
    if (!link.vmKey && host.role !== "linux") return empty("incomplete_scope", "unknown");
    if (!agents.some(agent => agent.hostKey === host.hostKey)) agents.push({ hostKey: host.hostKey, disabled: host.disabled });
  }
  const hostKeys = agents.map(agent => agent.hostKey);
  if (!hostKeys.length) return empty("no_scope", "unknown");
  if (agents.every(agent => agent.disabled)) return { ...empty("suppressed", "suppressed", hostKeys), complete: true };
  if (agents.some(agent => agent.disabled)) return empty("incomplete_scope", "unknown", hostKeys);

  let matches: (name: string) => boolean;
  try { matches = compileSelector("name_prefix", input.servicePrefix); }
  catch { return empty("invalid_prefix", "unknown", hostKeys); }
  const candidates = input.containers.filter(container => hostKeys.includes(container.hostKey) && matches(container.name));
  const coverageComplete = hostKeys.every(key => input.coverage.some(item => item.hostKey === key && item.complete && item.fresh));
  const enumerated = coverageComplete
    ? input.coverage.filter(item => hostKeys.includes(item.hostKey)).flatMap(item => item.names).filter(matches)
    : [];
  if (enumerated.some(name => !candidates.some(container => container.name === name))) return empty("enumeration_pending", "unknown", hostKeys);

  const fresh = candidates.filter(container => container.statusFresh && container.status !== "unknown");
  const running = fresh.filter(container => container.status === "running");
  const terminal = fresh.filter(container => container.status === "stopped" || container.status === "dead");
  const other = fresh.filter(container => !["running", "stopped", "dead"].includes(container.status));
  const uncertain = candidates.length - fresh.length;
  const base = { hostKeys, candidateCount: candidates.length, runningCount: running.length };

  const selected = (candidate: ServiceObservedContainer, reason: string): SignalServiceResolution => ({
    ...base, ...kpi(candidate, false), resolution: "selected", reason, complete: true, candidate,
  });

  if (running.length > 1) return { ...empty("ambiguous", "ambiguous", hostKeys), ...base };
  if (running.length === 1 && other.length === 0 && uncertain === 0) return selected(running[0], "running");
  if (running.length === 1) return { ...empty("mixed", "unknown", hostKeys), ...base };
  if (candidates.length === 1 && fresh.length === 1) return selected(fresh[0], "single");
  if (candidates.length > 0 && uncertain === 0 && other.length === 0 && terminal.length === candidates.length) {
    return { ...empty("down", "down", hostKeys), ...base, complete: true, tone: "bad", kpiLabel: "Fora", statusState: "unavailable" };
  }
  if (candidates.length > 0) return { ...empty("mixed", "unknown", hostKeys), ...base };
  if (coverageComplete) return { ...empty("absent", "down", hostKeys), ...base, complete: true, tone: "bad", kpiLabel: "Fora", statusState: "unavailable" };
  return { ...empty("coverage_unavailable", "unknown", hostKeys), ...base };
}
