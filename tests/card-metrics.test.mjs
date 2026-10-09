import { test } from "node:test";
import assert from "node:assert/strict";
import { mergeCardCpuRam, resolveCardCpuRam } from "../lib/monitoring/card-metrics.ts";

const metric = (value) => ({ value, unit: "percent", observedAt: "2026-10-08T00:00:00.000Z", quality: "fresh", validUntil: null });
const agent = (hostKey, cpu, ram) => ({
  hostKey, name: hostKey, role: "linux", availability: "reachable",
  metrics: cpu == null && ram == null ? {} : { cpuUsagePercent: metric(cpu), memoryUsagePercent: metric(ram) },
  storages: [], filesystems: [], interfaces: [], vms: [],
  evidence: { source: "zabbix", observedAt: "2026-10-08T00:00:00.000Z", basis: "item" },
});
const hypervisor = (vms) => ({
  hostKey: "ASGARD", name: "ASGARD", role: "hypervisor", availability: "reachable",
  metrics: { cpuUsagePercent: metric(40), memoryUsagePercent: metric(50) },
  storages: [], filesystems: [], interfaces: [], vms,
  evidence: { source: "zabbix", observedAt: "2026-10-08T00:00:00.000Z", basis: "item" },
});
const vm = (name, linuxHostKey, cpu, ram) => ({
  vmKey: "vm-" + name, vmId: "1", name, parentHostKey: "ASGARD", linuxHostKey, state: "running",
  metrics: {
    cpuUsagePercent: metric(cpu), memoryUsagePercent: metric(ram),
    memoryUsedBytes: { value: 11.9 * 1024 ** 3, unit: "bytes", observedAt: "2026-10-08T00:00:00.000Z", quality: "fresh", validUntil: null },
    memoryTotalBytes: { value: 32 * 1024 ** 3, unit: "bytes", observedAt: "2026-10-08T00:00:00.000Z", quality: "fresh", validUntil: null },
  },
  evidence: { source: "zabbix", observedAt: "2026-10-08T00:00:00.000Z", basis: "item" },
});

test("default / hypervisor uses the same CPU/RAM as the Asgard VM list row", () => {
  const linux = agent("vm-squad-ia-01", 1.8, 5);
  const hosts = [hypervisor([vm("vm-squad-ia-01", "vm-squad-ia-01", 2.9, 37.1)]), linux];
  const resolved = resolveCardCpuRam(linux, hosts, "hypervisor");
  assert.equal(resolved.source, "hypervisor");
  assert.equal(resolved.metrics.cpuUsagePercent.value, 2.9);
  assert.equal(resolved.metrics.memoryUsagePercent.value, 37.1);
});

test("auto prefers the VM list metrics when the host is linked", () => {
  const linux = agent("vm-squad-ia-01", 1.8, 5);
  const hosts = [hypervisor([vm("vm-squad-ia-01", "vm-squad-ia-01", 2.9, 37.1)]), linux];
  const resolved = resolveCardCpuRam(linux, hosts, "auto");
  assert.equal(resolved.source, "hypervisor");
  assert.equal(resolved.metrics.memoryUsagePercent.value, 37.1);
});

test("preference agent keeps guest metrics even when a VM is linked", () => {
  const linux = agent("vm-squad-ia-01", 1.8, 5);
  const hosts = [hypervisor([vm("vm-squad-ia-01", "vm-squad-ia-01", 2.9, 37.1)]), linux];
  const resolved = resolveCardCpuRam(linux, hosts, "agent");
  assert.equal(resolved.source, "agent");
  assert.equal(resolved.metrics.cpuUsagePercent.value, 1.8);
  assert.equal(resolved.metrics.memoryUsagePercent.value, 5);
});

test("Agent without a linked VM keeps Agent CPU/RAM", () => {
  const linux = agent("orphan-agent", 1.8, 5);
  const hosts = [hypervisor([]), linux];
  const resolved = resolveCardCpuRam(linux, hosts, "hypervisor");
  assert.equal(resolved.source, "agent");
  assert.equal(resolved.metrics.cpuUsagePercent.value, 1.8);
});

test("hypervisor host cards keep hypervisor metrics", () => {
  const asgard = hypervisor([]);
  assert.equal(resolveCardCpuRam(asgard, [asgard]).source, "hypervisor");
  assert.equal(resolveCardCpuRam(asgard, [asgard]).metrics.cpuUsagePercent.value, 40);
});

test("merge keeps non-cpu/ram metrics from the base payload", () => {
  const merged = mergeCardCpuRam(
    { uptimeSeconds: metric(99), cpuUsagePercent: metric(9) },
    { cpuUsagePercent: metric(2.9), memoryUsagePercent: metric(37.1) },
  );
  assert.equal(merged.uptimeSeconds.value, 99);
  assert.equal(merged.cpuUsagePercent.value, 2.9);
  assert.equal(merged.memoryUsagePercent.value, 37.1);
});
