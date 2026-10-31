import { resourceConfigSchema } from "../../lib/config/resources.ts";
import type { CardMetric } from "../../lib/config/agent-monitoring.ts";
import type { ConfiguredResource, Host, Metric } from "../../lib/monitoring/contracts.ts";

export type ResourceCardScenario = "selected" | "root" | "standalone" | "missing" | "binding" | "unconfigured" | "zero" | "stale" | "expired" | "ram-bytes";
export function resourceCardData(mode: ResourceCardScenario = "selected", pair: CardMetric[] = ["cpu", "disk"], source: "agent" | "hypervisor" = "hypervisor") {
  const at = new Date().toISOString(), until = new Date(Date.now() + (mode === "expired" ? -1000 : 3600000)).toISOString();
  const metric = (value: number, unit: Metric["unit"] = "percent"): Metric => ({ value, unit, quality: mode === "stale" ? "stale" : "fresh", observedAt: at, validUntil: until });
  const evidence = { source: "zabbix" as const, basis: "item" as const, observedAt: at, validUntil: until };
  const rootKey = `device-${"a".repeat(32)}`, dataKey = `device-${"b".repeat(32)}`, vmKey = `vm-${"a".repeat(32)}`;
  const rootMetrics = { diskUsagePercent: metric(mode === "zero" ? 0 : 80), diskUsedBytes: metric(mode === "zero" ? 0 : 80, "bytes"), diskTotalBytes: metric(100, "bytes") };
  const host: Host = {
    hostKey: "review-agent", name: "VM de teste", role: "linux", availability: "reachable", evidence,
    metrics: { cpuUsagePercent: metric(10.8), memoryUsagePercent: metric(35), ...rootMetrics },
    filesystems: [{ key: rootKey, name: "/", metrics: rootMetrics }, ...(mode === "missing" ? [] : [{ key: dataKey, name: "/data", metrics: { diskUsagePercent: metric(5), diskUsedBytes: metric(20, "bytes"), diskTotalBytes: metric(400, "bytes") } }])],
    storages: [], interfaces: [], vms: [],
  };
  const parent: Host = {
    hostKey: "review-parent", name: "Hipervisor de teste", role: "hypervisor", availability: "reachable", evidence, metrics: {}, filesystems: [], storages: [], interfaces: [],
    vms: mode === "standalone" ? [] : [{ vmKey, vmId: "1", name: "VM de teste", parentHostKey: "review-parent", linuxHostKey: mode === "binding" ? null : host.hostKey, state: "running", evidence, metrics: { cpuUsagePercent: metric(12.9), memoryUsagePercent: metric(40) } }],
  };
  if (mode === "ram-bytes") {
    for (const metrics of [host.metrics, parent.vms[0].metrics]) {
      delete metrics.memoryUsagePercent;
      metrics.memoryUsedBytes = metric(32, "bytes");
    }
  }
  const config = resourceConfigSchema.parse({
    id: "00000000-0000-4000-8000-000000000019", revision: 1, resourceType: "host", zabbixHostKey: host.hostKey, displayName: "Agenda", description: "Portal da Agenda Web", serviceType: "Front/API", dashboardEnabled: true,
    createdAt: at, updatedAt: at, presentation: { showCpu: true, showMemory: true, showDisk: true, metricsSource: source, cardMetrics: pair },
    agentMonitoring: ["root", "standalone"].includes(mode) ? {} : { schemaVersion: 1, vmBinding: { parentHostKey: parent.hostKey, vmKey }, capacity: { filesystemKeys: mode === "unconfigured" ? [] : mode === "zero" ? [rootKey] : [rootKey, dataKey], independentVolumesConfirmed: mode !== "zero" }, thresholds: { cpu: null, memory: null, disk: null } },
  });
  const resource: ConfiguredResource = { id: config.id, config, resolved: true, resolution: "resolved", resource: host, metrics: host.metrics };
  return { resource, hosts: [parent, host] };
}
