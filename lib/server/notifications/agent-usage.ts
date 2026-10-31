import "server-only";
import type { ResourceConfig } from "../../config/resources.ts";
import { agentMonitoring, type CardMetric } from "../../config/agent-monitoring.ts";
import { agentBindingValid, usageMetric } from "../../monitoring/agent-monitoring.ts";
import type { Host } from "../../monitoring/contracts.ts";
import type { NotificationTarget } from "./targets.ts";
import { safelyRecordNotifications, type NotificationObservation } from "./engine.ts";
import { usageRule } from "./usage-rule.ts";
import { recoveryLimit } from "../../notifications/usage.ts";

export async function recordAgentUsage(input: { targets: NotificationTarget[]; configs: ResourceConfig[]; hosts: Host[]; disabledHosts: string[]; checkedAt: number; scopeRevision: number; signal?: AbortSignal }) {
  const signal = AbortSignal.any([AbortSignal.timeout(2200), ...(input.signal ? [input.signal] : [])]);
  for (const config of input.configs) {
    if (signal.aborted) return;
    const settings = agentMonitoring(config.agentMonitoring), target = input.targets.find(target => target.ref === `resource:${config.id}`);
    if (!settings || !target || config.resourceType !== "host") continue;
    const host = input.hosts.find(host => host.hostKey === config.zabbixHostKey && host.role === "linux");
    const suppressed = input.disabledHosts.includes(config.zabbixHostKey) || !!host && !agentBindingValid(host.hostKey, settings, input.hosts);
    const observations: NotificationObservation[] = [];
    for (const kind of ["cpu", "memory", "disk"] as CardMetric[]) {
      const limit = settings.thresholds[kind];
      if (limit === null) continue;
      const { metric, operands } = host ? usageMetric(host, settings, kind) : { metric: undefined, operands: [] };
      const valid = !!host && !suppressed && !!metric && metric.quality === "fresh" && metric.unit === "percent" && metric.value !== null && !!metric.validUntil && Date.parse(metric.validUntil) > input.checkedAt;
      const sampleAt = operands.length ? Math.max(...operands.map(m => Date.parse(m.sampleObservedAt ?? m.observedAt ?? "") || 0)) : 0;
      observations.push({ key: `metric:${kind}`, family: "metrics", source: "zabbix", eventType: "usage", messageCode: `usage_${kind}`,
        observation: { epoch: target.epoch, fingerprint: `metric:${kind}:${sampleAt}`, checkedAt: input.checkedAt, observedAt: sampleAt,
          validUntil: metric?.validUntil ? Date.parse(metric.validUntil) : 0, state: suppressed ? "suppressed" : "unknown", severity: "warning", sourceSeverity: null, confirmation: "explicit" },
        usage: { metric: kind, limit, token: JSON.stringify(operands.map(m => [m.sampleObservedAt ?? m.observedAt, m.value])), sampleAt,
          validUntil: metric?.validUntil ? Date.parse(metric.validUntil) : 0, value: valid ? metric!.value : null, rule: usageRule(settings, kind), scopeRevision: input.scopeRevision },
        metricContext: valid ? { metric: kind, valuePercent: metric!.value!, thresholdPercent: limit, recoveryPercent: recoveryLimit(limit), source: "agent", observedAt: metric!.observedAt!, coverage: kind === "disk" ? `Volumes monitorados · ${settings.capacity.filesystemKeys.length}` : "Agent" } : undefined,
      });
    }
    if (observations.length) await safelyRecordNotifications(target, observations, [], signal);
  }
}
