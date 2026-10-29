import "server-only";
import type { NotificationTarget } from "./targets.ts";
import { safelyRecordNotifications, type NotificationObservation } from "./engine.ts";
import { resolveSignalService, type ServiceHostCoverage, type ServiceObservedContainer, type ServiceScopeHost, type ServiceScopeLink, type ServiceScopeVm } from "../../signal/service-resolver.ts";

type ServiceRow = { id: string; targetId: string; servicePrefix: string; enabled: boolean };

function observation(target: NotificationTarget, key: string, family: NotificationObservation["family"], state: NotificationObservation["observation"]["state"], checkedAt: number): NotificationObservation {
  return {
    key, family, source: "zabbix",
    eventType: state === "attention" ? "attention" : "unavailable",
    messageCode: state === "attention" ? "attention" : "unavailable",
    observation: {
      epoch: target.epoch, fingerprint: `${key}:${state}`, checkedAt, observedAt: checkedAt, validUntil: checkedAt + 120000,
      state, severity: state === "attention" ? "warning" : state === "healthy" ? "info" : "critical",
      sourceSeverity: null, confirmation: state === "attention" ? "sampled" : "explicit",
    },
  };
}

export async function recordSignalServiceNotifications(input: {
  targets: NotificationTarget[];
  services: ServiceRow[];
  links: (ServiceScopeLink & { targetId: string })[];
  hosts: ServiceScopeHost[];
  vms: ServiceScopeVm[];
  containers: ServiceObservedContainer[];
  coverage: ServiceHostCoverage[];
  checkedAt: number;
  signal?: AbortSignal;
}, record: typeof safelyRecordNotifications = safelyRecordNotifications) {
  const targets = input.targets.filter(target => target.kind === "signal_service");
  for (const target of targets) {
    if (input.signal?.aborted) return;
    const service = input.services.find(item => item.id === target.id);
    if (!service) continue;
    const resolution = resolveSignalService({
      servicePrefix: service.servicePrefix,
      links: input.links.filter(link => link.targetId === service.targetId),
      hosts: input.hosts, vms: input.vms, containers: input.containers, coverage: input.coverage,
    });
    const observations: NotificationObservation[] = [];
    const families: string[] = [];
    if (resolution.resolution === "suppressed") {
      observations.push(observation(target, "availability", "availability", "suppressed", input.checkedAt));
    } else {
      observations.push(observation(target, "status", "status", resolution.statusState === "suppressed" ? "unknown" : resolution.statusState, input.checkedAt));
      observations.push(observation(target, "health", "health", resolution.healthState, input.checkedAt));
      if (resolution.statusState === "healthy" || resolution.statusState === "unavailable" || resolution.statusState === "attention") families.push("status");
      if (resolution.healthState === "healthy" || resolution.healthState === "unavailable") families.push("health");
    }
    await record(target, observations, families, input.signal);
  }
}
