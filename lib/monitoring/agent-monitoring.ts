import { agentMonitoring, type CardMetric } from "../config/agent-monitoring.ts";
import type { Host, Metric } from "./contracts.ts";
import { filesystemCapacity } from "./filesystem-capacity.ts";

export function agentCapacity(host: Host, preferences: unknown) {
  const config = agentMonitoring(preferences);
  return filesystemCapacity(host.filesystems, config?.capacity ?? { filesystemKeys: [], independentVolumesConfirmed: false });
}
export function agentBindingValid(hostKey: string, config: NonNullable<ReturnType<typeof agentMonitoring>>, hosts: Host[]) {
  const matches = hosts.flatMap(host => host.vms).filter(vm => vm.linuxHostKey === hostKey && !vm.name.startsWith("tpl"));
  return matches.length === 1 && matches[0].vmKey === config.vmBinding.vmKey && matches[0].parentHostKey === config.vmBinding.parentHostKey;
}
export function usageMetric(host: Host, preferences: unknown, kind: CardMetric): { metric?: Metric; operands: Metric[] } {
  if (kind === "cpu") return { metric: host.metrics.cpuUsagePercent, operands: [host.metrics.cpuUsagePercent].filter((m): m is Metric => !!m) };
  if (kind === "memory") return { metric: host.metrics.memoryUsagePercent, operands: [host.metrics.memoryUsagePercent].filter((m): m is Metric => !!m) };
  const config = agentMonitoring(preferences), capacity = agentCapacity(host, preferences);
  return { metric: capacity.usagePercent, operands: host.filesystems.filter(fs => config?.capacity.filesystemKeys.includes(fs.key)).flatMap(fs => [fs.metrics.diskUsedBytes, fs.metrics.diskTotalBytes].filter((m): m is Metric => !!m)) };
}
