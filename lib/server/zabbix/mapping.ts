import "server-only";
import type { Metric, Metrics } from "../../monitoring/contracts.ts";
import { keyParts, metric, type ObservationContext } from "./observations.ts";
import type { Binding } from "./bindings.ts";
import type { Item } from "./types.ts";

type Rule = { field: keyof Metrics; unit: Metric["unit"]; units: string[]; scale?: number; offset?: number; rate?: boolean };
const rule = (field: keyof Metrics, unit: Metric["unit"], units: string[], scale = 1, offset = 0): Rule => ({ field, unit, units, scale, offset });
const bytes = (field: keyof Metrics) => rule(field, "bytes", ["B"]);
const percent = (field: keyof Metrics) => rule(field, "percent", ["%"]);
const time = rule("uptimeSeconds", "seconds", ["uptime", "s"]);
const proxmox: Record<string, Rule> = {
  cpu: percent("cpuUsagePercent"), mem: bytes("memoryUsedBytes"), memused: bytes("memoryUsedBytes"),
  maxmem: bytes("memoryTotalBytes"), memtotal: bytes("memoryTotalBytes"), uptime: time,
  rootused: bytes("diskUsedBytes"), roottotal: bytes("diskTotalBytes"), disk: bytes("diskUsedBytes"), maxdisk: bytes("diskTotalBytes"),
  diskread: rule("diskReadBytesPerSecond", "bytes/s", ["Bps", "B/s"]), diskwrite: rule("diskWriteBytesPerSecond", "bytes/s", ["Bps", "B/s"]),
  netin: rule("networkReceiveBitsPerSecond", "bits/s", ["bps", "b/s"]), netout: rule("networkTransmitBitsPerSecond", "bits/s", ["bps", "b/s"]),
};
const docker: Record<string, Rule> = {
  "docker.container_stats.memory.usage_active": bytes("memoryUsedBytes"),
  "docker.container_stats.memory.usage_total": bytes("memoryUsedBytes"),
  "docker.container_stats.memory.limit": bytes("memoryTotalBytes"),
  "docker.container_stats.cpu_usage.total.rate": { ...rule("cpuUsagePercent", "percent", ["s"], 100), rate: true },
  "docker.networks.rx_bytes": { ...rule("networkReceiveBitsPerSecond", "bits/s", ["B"], 8), rate: true },
  "docker.networks.tx_bytes": { ...rule("networkTransmitBitsPerSecond", "bits/s", ["B"], 8), rate: true },
  "docker.container_info.restart_count": rule("restartCount", "count", [""]),
};
export function metricRule(item: Item): Rule | null {
  const { base, args } = keyParts(item.key_);
  let result: Rule | undefined;
  if (base === "proxmox.qemu.cpus" && args.length === 1 && /^(qemu\/)?\d+$/.test(args[0]) && item.type === "18" && item.value_type === "3" && item.preprocessing[0]?.type === "12" && item.preprocessing[0].params === "$.data.cpus" && item.preprocessing.slice(1).every(step => step.type === "20")) result = rule("provisionedCpuCount", "count", [""]);
  else if (/^proxmox\.(node|qemu|lxc)\./.test(base)) result = proxmox[base.split('.').slice(2).join('.')];
  else if (docker[base]) result = docker[base];
  else if (base === "system.uptime") result = time;
  else if (base === "system.cpu.num" && !args.length && item.value_type === "3") result = rule("osCpuCount", "count", [""]);
  else if (base === "system.cpu.util" && !args.length) result = percent("cpuUsagePercent");
  else if (base === "system.cpu.util" && args[1] === "idle") result = rule("cpuUsagePercent", "percent", ["%"], -1, 100);
  else if (base === "vm.memory.util") result = percent("memoryUsagePercent");
  else if (base === "vm.memory.size" && args[0] === "total") result = bytes("memoryTotalBytes");
  else if (base === "vm.memory.size" && args[0] === "used") result = bytes("memoryUsedBytes");
  else if (/^vfs.fs.(dependent.size|size)$/.test(base)) result = ({ used: bytes("diskUsedBytes"), total: bytes("diskTotalBytes"), pused: percent("diskUsagePercent") })[args[1]];
  else if (/^net.if.(in|out)$/.test(base) && (!args[1] || args[1] === "bytes")) result = { ...rule(base.endsWith("in") ? "networkReceiveBitsPerSecond" : "networkTransmitBitsPerSecond", "bits/s", ["bps"]), rate: true };
  if (!result || !["0", "3"].includes(item.value_type)) return null;
  if (!result.units.includes(item.units) || (result.rate && !item.preprocessing.some(p => p.type === "10"))) return null;
  return result;
}
const scalar = new Set(["agent.ping", "zabbix", "proxmox.node.online", "proxmox.api.available", "proxmox.qemu.vmstatus", "proxmox.lxc.vmstatus", "docker.container_info.state.health", "docker.container_info.state.status", "docker.container_info.image", "docker.container_info.created", "docker.container_info.started", "docker.containers.running", "docker.containers.stopped", "docker.containers.total", "vm.memory.size"]);
export function needsValue(item: Item) { return !!metricRule(item) || scalar.has(keyParts(item.key_).base); }
export function provisionedCpuMaster(item: Item, context: ObservationContext) {
  if (metricRule(item)?.field !== "provisionedCpuCount") return undefined;
  const master = context.byId.get(item.master_itemid);
  const vmId = keyParts(item.key_).args[0].replace(/^qemu\//, "");
  return master?.hostid === item.hostid && master.key_ === `proxmox.qemu.get.data[qemu/${vmId}]` ? master : undefined;
}
export function stateBinding(item: Item | undefined, kind: "status" | "health", context: ObservationContext): Binding | null {
  if (!item || !["0", "1", "3", "4"].includes(item.value_type)) return null;
  const { quality, observedAt, maxGapSeconds } = context.evidence(item);
  const proof = context.historyProof(item);
  const discards = item.preprocessing.some(p => p.type === "19" || p.type === "20");
  return { key: kind, itemid: item.itemid, valueType: item.value_type as Binding["valueType"], unit: "count", scale: 1, offset: 0, kind, quality, observedAt, maxGapSeconds: discards && !proof ? Math.min(maxGapSeconds, 135) : maxGapSeconds, ...(proof ? { proof } : {}) };
}
export function mapMetrics(items: Item[], context: ObservationContext, prefix = "") {
  const metrics: Metrics = {}, bindings: Binding[] = [];
  const ordered = [...items].sort((a, b) => Number(a.key_.includes("usage_active") || a.key_ === "system.cpu.util") - Number(b.key_.includes("usage_active") || b.key_ === "system.cpu.util"));
  for (const item of ordered) {
    const r = metricRule(item);
    if (!r) continue;
    if (r.field === "provisionedCpuCount" && !provisionedCpuMaster(item, context)) continue;
    metrics[r.field] = metric(item, r.unit, context, r.scale, r.offset);
    const observed = metrics[r.field]!;
    if ((r.field === "provisionedCpuCount" || r.field === "osCpuCount") && (observed.value === null || !Number.isSafeInteger(observed.value) || observed.value <= 0)) {
      metrics[r.field] = { ...observed, value: null, quality: observed.quality === "unsupported" ? "unsupported" : "missing" };
    }
    const old = bindings.findIndex(binding => binding.key === prefix + r.field);
    if (old >= 0) bindings.splice(old, 1);
    const { quality, observedAt, maxGapSeconds } = context.evidence(item);
    bindings.push({ key: prefix + r.field, itemid: item.itemid, valueType: item.value_type as Binding["valueType"], unit: r.unit, scale: r.scale ?? 1, offset: r.offset ?? 0, kind: "numeric", quality, observedAt, maxGapSeconds });
  }
  deriveRatio(metrics, "memoryUsedBytes", "memoryTotalBytes", "memoryUsagePercent");
  deriveRatio(metrics, "diskUsedBytes", "diskTotalBytes", "diskUsagePercent");
  return { metrics, bindings };
}
function deriveRatio(metrics: Metrics, used: keyof Metrics, total: keyof Metrics, output: keyof Metrics) {
  const a = metrics[used], b = metrics[total];
  if (metrics[output] || !a || !b) return;
  const value = a.value !== null && b.value !== null && b.value > 0 ? a.value / b.value * 100 : null;
  const quality = value === null ? (a.quality === "unsupported" || b.quality === "unsupported" ? "unsupported" : "missing") : a.quality === "fresh" && b.quality === "fresh" ? "fresh" : "stale";
  metrics[output] = { value, unit: "percent", quality, observedAt: a.observedAt && b.observedAt ? [a.observedAt, b.observedAt].sort()[0] : null, validUntil: a.validUntil && b.validUntil ? [a.validUntil, b.validUntil].sort()[0] : null };
}
