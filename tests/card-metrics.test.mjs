import { test } from "node:test";
import assert from "node:assert/strict";
import { availabilityCardSlots, availabilityDiskMetric, mergeCardCpuRam, resolveAvailabilityCardMetrics, resolveCardCpuRam } from "../lib/monitoring/card-metrics.ts";
import { configuredResourceSchema } from "../lib/monitoring/contracts.ts";
import { cardResource } from "../lib/server/monitoring/read.ts";
import { resourceCardData } from "./fixtures/resource-card-data.ts";
import { cardMetricPresentation, mergeCardMetricPresentation } from "../lib/config/agent-monitoring.ts";

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

test("disk reading uses the host metric, or the root filesystem the VM row already shows", () => {
  const root = { name: "/", metrics: { diskUsagePercent: metric(56.4) } };
  assert.equal(availabilityDiskMetric({ diskUsagePercent: metric(56.4) }, []).value, 56.4);
  assert.equal(availabilityDiskMetric({}, [root, { name: "/var", metrics: { diskUsagePercent: metric(10) } }]).value, 56.4);
  assert.equal(availabilityDiskMetric({}, []), undefined);
  assert.equal(availabilityDiskMetric({}, [{ name: "/", metrics: { diskUsagePercent: metric(0) } }]).value, 0);
});

test("explicit pairs win over detail flags and legacy disk never adds a third reading", () => {
  assert.deepEqual(availabilityCardSlots({ showCpu: true, showMemory: false, showDisk: true }), ["cpu", "disk"]);
  assert.deepEqual(availabilityCardSlots({ showCpu: true, showMemory: true, showDisk: true }), ["cpu", "disk"]);
  assert.deepEqual(availabilityCardSlots({ showCpu: false, showMemory: true, showDisk: true }), ["disk", "memory"]);
  assert.deepEqual(availabilityCardSlots({ showCpu: true, showMemory: true, showDisk: true, cardMetrics: ["cpu", "memory"] }), ["cpu", "memory"]);
  assert.deepEqual(availabilityCardSlots({ showCpu: true, showMemory: true, showDisk: false, cardMetrics: ["disk", "memory"] }), ["disk", "memory"]);
  assert.deepEqual(availabilityCardSlots({ showCpu: false, showMemory: false, showDisk: true }), ["disk"]);
  assert.deepEqual(availabilityCardSlots({ showCpu: false, showMemory: false, showDisk: false }), []);
  assert.deepEqual(availabilityCardSlots({ showCpu: true, showMemory: true, showDisk: true }, "docker_container"), ["cpu", "memory"]);
});

test("preview and BFF share the selected weighted capacity independently of the CPU/RAM source", () => {
  for (const source of ["hypervisor", "agent"]) {
    const { resource, hosts } = resourceCardData("selected", ["cpu", "disk"], source);
    const preview = resolveAvailabilityCardMetrics(resource, hosts), card = cardResource(resource, hosts);
    assert.equal(preview.metrics.cpuUsagePercent.value, source === "agent" ? 10.8 : 12.9);
    assert.equal(card.metrics.diskUsagePercent.value, 20);
    assert.deepEqual(card.metrics, preview.metrics);
    assert.equal(card.cardDiskLabel, preview.cardDiskLabel);
    assert.match(card.cardDiskLabel, /2 volume/);
  }
});

test("missing selected volumes, unconfigured capacity and invalid VM binding never fall back to root", () => {
  for (const mode of ["missing", "binding", "unconfigured"]) {
    const { resource, hosts } = resourceCardData(mode);
    const card = cardResource(resource, hosts), preview = resolveAvailabilityCardMetrics(resource, hosts);
    for (const key of ["diskUsagePercent", "diskUsedBytes", "diskTotalBytes"]) {
      assert.equal(card.metrics[key], undefined); assert.equal(preview.metrics[key], undefined);
    }
    assert.match(card.cardDiskLabel, /indisponível/);
  }
});

test("standalone hosts keep root percent and observed zero without pretending it is a configured aggregate", () => {
  for (const source of ["agent", "hypervisor"]) {
    const { resource, hosts } = resourceCardData("standalone", ["cpu", "disk"], source);
    const card = cardResource(resource, hosts);
    assert.equal(card.metrics.cpuUsagePercent.value, 10.8);
    assert.equal(card.metrics.diskUsagePercent.value, 80); assert.equal(card.cardDiskLabel, "Filesystem raiz /");
  }
  const { resource, hosts } = resourceCardData("zero");
  assert.equal(cardResource(resource, hosts).metrics.diskUsagePercent.value, 0);
  assert.equal(availabilityDiskMetric({ diskUsedBytes: { ...metric(80), unit: "bytes" } }), undefined);
});

test("disk provenance survives public rule removal without exposing selected keys in the label", () => {
  const { resource, hosts } = resourceCardData();
  const card = JSON.parse(JSON.stringify(cardResource(resource, hosts)));
  delete card.config.agentMonitoring;
  const publicCard = configuredResourceSchema.parse(card);
  assert.equal(publicCard.metrics.diskUsagePercent.value, 20);
  assert.equal(publicCard.cardDiskLabel, "Armazenamento monitorado · 2 volumes");
  assert.equal(publicCard.cardDiskLabel.includes("device-"), false);
});

test("explicit card readings remain in the BFF even when detail flags are disabled", () => {
  const { resource, hosts } = resourceCardData();
  Object.assign(resource.config.presentation, { showCpu: false, showMemory: false, showDisk: false });
  const card = cardResource(resource, hosts);
  assert.equal(card.metrics.cpuUsagePercent.value, 12.9);
  assert.equal(card.metrics.diskUsagePercent.value, 20);
  assert.equal(card.metrics.memoryUsagePercent, undefined);
  assert.equal(card.resource.filesystems.length, 2);
});

test("one metric selection writes a coherent pair and legacy flags", () => {
  for (const pair of [["cpu", "memory"], ["cpu", "disk"], ["disk", "memory"]]) {
    const result = cardMetricPresentation(pair);
    assert.deepEqual(result.cardMetrics, pair);
    assert.equal(result.showCpu, pair.includes("cpu"));
    assert.equal(result.showMemory, pair.includes("memory"));
    assert.equal(result.showDisk, pair.includes("disk"));
  }
});

test("a legacy editor changing CPU and disk cannot retain its unchanged hidden disk/RAM pair", () => {
  const current = { ...cardMetricPresentation(["disk", "memory"]), showStatus: true, showNetwork: true, metricsSource: "agent" };
  const result = mergeCardMetricPresentation(current, { ...current, showCpu: true, showMemory: false, showDisk: true });
  assert.deepEqual(result, { ...current, ...cardMetricPresentation(["cpu", "disk"]) });
});

test("a newly selected explicit pair controls all metric flags even when old flags are echoed", () => {
  const current = cardMetricPresentation(["cpu", "disk"]);
  const result = mergeCardMetricPresentation(current, { ...current, cardMetrics: ["disk", "memory"] });
  assert.deepEqual(result, cardMetricPresentation(["disk", "memory"]));
  assert.deepEqual(mergeCardMetricPresentation(result, { metricsSource: "hypervisor" }), { ...result, metricsSource: "hypervisor" });
});

test("legacy edits with one or no reading do not preserve a contradictory hidden pair", () => {
  const current = cardMetricPresentation(["cpu", "memory"]);
  const one = mergeCardMetricPresentation(current, { showMemory: false });
  assert.equal(one.cardMetrics, undefined); assert.deepEqual(availabilityCardSlots(one), ["cpu"]);
  const none = mergeCardMetricPresentation(current, { showCpu: false, showMemory: false });
  assert.equal(none.cardMetrics, undefined); assert.deepEqual(availabilityCardSlots(none), []);
});
