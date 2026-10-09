import type { Host, Metrics, Metric, VirtualMachine } from "./contracts.ts";

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
