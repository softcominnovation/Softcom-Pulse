import type { CardMetric } from "../config/agent-monitoring.ts";
import { agentMonitoring, legacyCardMetrics } from "../config/agent-monitoring.ts";
import { agentBindingValid, agentCapacity } from "./agent-monitoring.ts";
import { filesystemCapacity } from "./filesystem-capacity.ts";
import type { ConfiguredResource, Host, Metrics, Metric, VirtualMachine } from "./contracts.ts";

export type CardMetricsSource = "agent" | "hypervisor";
/** Preference stored on host resource presentation. */
export type CardMetricsPreference = "auto" | "agent" | "hypervisor";

function usable(metric: Metric | undefined) {
  return metric != null && metric.value !== null;
}

function hasCpuOrRam(metrics: Metrics) {
  return usable(metrics.cpuUsagePercent) || usable(metrics.memoryUsagePercent) || usable(metrics.memoryUsedBytes);
}

function pickCpuRam(metrics: Metrics): Metrics {
  const next: Metrics = {};
  if (metrics.cpuUsagePercent) next.cpuUsagePercent = metrics.cpuUsagePercent;
  if (metrics.memoryUsagePercent) next.memoryUsagePercent = metrics.memoryUsagePercent;
  if (metrics.memoryUsedBytes) next.memoryUsedBytes = metrics.memoryUsedBytes;
  if (metrics.memoryTotalBytes) next.memoryTotalBytes = metrics.memoryTotalBytes;
  return next;
}

function linkedVm(hostKey: string, hosts: Host[]): VirtualMachine | undefined {
  return hosts.flatMap(host => host.vms).find(vm => vm.linuxHostKey === hostKey);
}

/**
 * CPU/RAM on availability + infrastructure host cards.
 * - hypervisor: same metrics as the Asgard VM list row (`vm.metrics`)
 * - agent: Linux host / Zabbix Agent metrics
 * - auto: listagem (VM) when linked; otherwise Agent
 */
export function resolveCardCpuRam(
  host: Host,
  hosts: Host[],
  preference: CardMetricsPreference = "hypervisor",
): { metrics: Metrics; source: CardMetricsSource } {
  if (host.role !== "linux") {
    return { metrics: pickCpuRam(host.metrics), source: "hypervisor" };
  }

  const agent = pickCpuRam(host.metrics);
  const vm = linkedVm(host.hostKey, hosts);
  const listing = vm && hasCpuOrRam(vm.metrics) ? pickCpuRam(vm.metrics) : null;

  if (preference === "agent") return { metrics: agent, source: "agent" };
  if (preference === "hypervisor") {
    if (listing) return { metrics: listing, source: "hypervisor" };
    return { metrics: agent, source: "agent" };
  }

  if (listing) return { metrics: listing, source: "hypervisor" };
  return { metrics: agent, source: "agent" };
}

export function mergeCardCpuRam(base: Metrics, preferred: Metrics): Metrics {
  return {
    ...base,
    ...preferred,
    cpuUsagePercent: preferred.cpuUsagePercent ?? base.cpuUsagePercent,
    memoryUsagePercent: preferred.memoryUsagePercent ?? base.memoryUsagePercent,
    memoryUsedBytes: preferred.memoryUsedBytes ?? base.memoryUsedBytes,
    memoryTotalBytes: preferred.memoryTotalBytes ?? base.memoryTotalBytes,
  };
}

export function hostMetricsPreference(presentation: { metricsSource?: CardMetricsPreference } | undefined): CardMetricsPreference {
  return presentation?.metricsSource ?? "hypervisor";
}

/** Explicit metrics own the minicard; legacy flags never produce a third reading. */
export function availabilityCardSlots(presentation: { showCpu?: boolean; showMemory?: boolean; showDisk?: boolean; cardMetrics?: readonly CardMetric[] }, resourceType: "host" | "docker_container" = "host"): CardMetric[] {
  if (presentation.cardMetrics) return [...presentation.cardMetrics];
  if (resourceType === "host") return legacyCardMetrics(presentation);
  const flagged: CardMetric[] = [];
  if (presentation.showCpu) flagged.push("cpu");
  if (presentation.showMemory) flagged.push("memory");
  return flagged;
}

/** Only legacy, unconfigured disk readings may use the root filesystem. */
export function availabilityDiskMetric(metrics: Metrics, filesystems: { name: string; metrics: Metrics }[] = []): Metric | undefined {
  const root = filesystems.find(fs => fs.name === "/");
  if (!root) return metrics.diskUsagePercent?.unit === "percent" ? metrics.diskUsagePercent : undefined;
  if (root.metrics.diskUsagePercent?.unit === "percent" && root.metrics.diskUsagePercent.value !== null) return root.metrics.diskUsagePercent;
  return filesystemCapacity([{ ...root, key: "root" }]).usagePercent;
}

export function resolveAvailabilityCardMetrics(resource: ConfiguredResource, hosts: Host[] = []): { metrics: Metrics; cardDiskLabel: string } {
  const target = resource.resource;
  const host = target && !("reference" in target) ? target : null;
  const preferred = host ? resolveCardCpuRam(host, hosts, hostMetricsPreference(resource.config.presentation)).metrics : {};
  const metrics = mergeCardCpuRam(resource.metrics, preferred);
  const hasSettings = !!resource.config.agentMonitoring && Object.keys(resource.config.agentMonitoring).length > 0;
  if (hasSettings) {
    const settings = agentMonitoring(resource.config.agentMonitoring);
    const capacity = resource.resolved && host && settings && agentBindingValid(host.hostKey, settings, hosts) ? agentCapacity(host, settings) : undefined;
    return {
      metrics: { ...metrics, diskUsagePercent: capacity?.usagePercent, diskUsedBytes: capacity?.usedBytes, diskTotalBytes: capacity?.totalBytes },
      cardDiskLabel: capacity?.coverage === "complete" ? `Armazenamento monitorado · ${capacity.filesystemKeys.length} ${capacity.filesystemKeys.length === 1 ? "volume" : "volumes"}` : "Capacidade configurada indisponível: confira os volumes e o vínculo da VM.",
    };
  }
  return {
    metrics: { ...metrics, diskUsagePercent: resource.resolved ? availabilityDiskMetric(resource.metrics, host?.filesystems) : undefined },
    cardDiskLabel: host?.filesystems.some(fs => fs.name === "/") ? "Filesystem raiz /" : "Disco do recurso",
  };
}
