import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { resourceInputSchema, resourcePatchSchema } from "../lib/config/resources.ts";
import { initialPresentation, presentationWriteSchema } from "../lib/config/presentation.ts";
import { compileSelector, resolveResource } from "../lib/monitoring/selectors.ts";
import { metricSchema, hostSchema, containerSchema } from "../lib/monitoring/contracts.ts";
import { snapshotTiming, readResult } from "../lib/server/cache/snapshots.ts";

const host = { resourceType: "host", zabbixHostKey: "asgard" };
const container = { resourceType: "docker_container", zabbixHostKey: "vm-one", selectorType: "name_prefix", selectorValue: "evolution_evolution" };
const settings = () => { const { revision, ...settings } = initialPresentation(randomUUID); return { expectedRevision: revision, settings }; };

test("resource schemas reject telemetry and enforce type-specific defaults and selectors", () => {
  const parsed = resourceInputSchema.parse(host);
  assert.equal(parsed.description, null);
  assert.equal(parsed.serviceType, null);
  assert.deepEqual(resourcePatchSchema.parse({ description: "  Portal  ", serviceType: "  API " }), { description: "Portal", serviceType: "API" });
  assert.deepEqual(resourcePatchSchema.parse({ description: " ", serviceType: "" }), { description: null, serviceType: null });
  for (const fields of [{ description: "x".repeat(241) }, { serviceType: "x".repeat(41) }, { description: "a\nb" }, { serviceType: "a\u0000" }]) assert.equal(resourceInputSchema.safeParse({ ...host, ...fields }).success, false);
  assert.equal(parsed.selectorType, null);
  assert.deepEqual(parsed.presentation, { showStatus: true, showCpu: true, showMemory: true, showDisk: false, showNetwork: false, showUptime: false, metricsSource: "hypervisor" });
  assert.equal(resourceInputSchema.parse(container).presentation.showHealth, false);
  for (const invalid of [{ ...host, cpu: 0 }, { ...host, source: "proxmox" }, { ...host, selectorType: "exact_name" },
    { ...host, presentation: { showHealth: true } }, { ...host, presentation: { cpu: 0 } },
    { ...container, selectorValue: null }, { ...container, selectorType: "regex", selectorValue: "[" },
    { ...container, selectorType: "regex", selectorValue: "(a)\\1" },
    { ...container, presentation: { showHealthTimeline: true } }, { ...host, displayOrder: -1 }, { ...host, displayName: "x".repeat(121) }]) {
    assert.equal(resourceInputSchema.safeParse(invalid).success, false, JSON.stringify(invalid));
  }
  assert.deepEqual(resourcePatchSchema.parse({ displayName: "New name" }), { displayName: "New name" });
  assert.equal(resourcePatchSchema.safeParse({}).success, false);
  assert.equal(resourcePatchSchema.safeParse({ status: "running" }).success, false);
  assert.equal(resourceInputSchema.parse({ ...container, presentation: { showHealth: true, showHealthTimeline: true, healthTimelineRange: "24h" } }).presentation.showHealthTimeline, true);
  assert.equal(resourceInputSchema.parse({ ...host, presentation: { metricsSource: "hypervisor" } }).presentation.metricsSource, "hypervisor");
  assert.equal(resourceInputSchema.safeParse({ ...host, presentation: { metricsSource: "guest" } }).success, false);
  assert.equal(resourceInputSchema.safeParse({ ...container, presentation: { metricsSource: "agent" } }).success, false);
});
test("selectors isolate hosts, delimit Swarm prefixes and report ambiguity", () => {
  const config = resourceInputSchema.parse(container);
  const inventory = { hosts: [{ hostKey: "asgard" }], containers: [
    { hostKey: "vm-one", name: "evolution_evolution.1.abc" },
    { hostKey: "vm-two", name: "evolution_evolution.1.xyz" },
    { hostKey: "vm-one", name: "evolution_evolution_backup.1.abc" },
  ] };
  assert.equal(resolveResource(config, inventory).target.name, "evolution_evolution.1.abc");
  assert.equal(resolveResource({ ...config, selectorValue: "evolution_evolution." }, inventory).resolved, true);
  assert.equal(resolveResource({ ...config, selectorType: "exact_name", selectorValue: "missing" }, inventory).resolution, "missing");
  assert.equal(resolveResource({ ...config, selectorType: "exact_name", selectorValue: "evolution_evolution.1.abc" }, inventory).resolved, true);
  assert.equal(resolveResource({ ...config, selectorType: "name_contains", selectorValue: "evolution" }, inventory).resolution, "ambiguous");
  inventory.containers.push({ hostKey: "vm-one", name: "evolution_evolution.2.def" });
  assert.deepEqual(resolveResource(config, inventory), { resolved: false, resolution: "ambiguous", target: null });
  assert.equal(resolveResource(resourceInputSchema.parse(host), inventory).target.hostKey, "asgard");
});
test("pathological regex has bounded evaluation and oversized names never match", { timeout: 3000 }, () => {
  const start = performance.now();
  const matches = compileSelector("regex", "(a+)+$");
  for (let i = 0; i < 1000; i++) assert.equal(matches("a".repeat(510) + "!"), false);
  assert.ok(performance.now() - start < 2000);
  assert.equal(compileSelector("regex", ".*")("a".repeat(513)), false);
  assert.throws(() => compileSelector("regex", "x".repeat(257)));
});
test("presentation limits, IDs, references and rotation are strict", () => {
  const base = settings();
  assert.equal(presentationWriteSchema.safeParse(base).success, true);
  const cases = [
    value => { value.settings.revision = 900; },
    value => { value.settings.rotation.autoStart = true; },
    value => { value.settings.rotation.intervalSeconds = 4; },
    value => { value.settings.rotation.intervalSeconds = 301; },
    value => { value.settings.screens[0].enabled = false; },
    value => { value.settings.screens[0].blocks[0].id = value.settings.screens[0].id; },
    value => { value.settings.screens[0].blocks[0].resourceConfigId = randomUUID(); },
    value => { value.settings.screens[0].blocks[0].type = "resource_card"; },
    value => { value.settings.screens[0].blocks[0].html = "<script>"; },
    value => { value.settings.screens[0].blocks = []; },
    value => { value.settings.screens = Array.from({ length: 4 }, () => settings().settings.screens[0]); },
  ];
  for (const modify of cases) { const value = structuredClone(base); modify(value); assert.equal(presentationWriteSchema.safeParse(value).success, false); }
  base.settings.screens.push(settings().settings.screens[0]);
  base.settings.rotation.autoStart = true;
  assert.equal(presentationWriteSchema.safeParse(base).success, true);
});
test("unknown metrics remain null, observed zero remains zero, and DTOs strip internal identifiers", () => {
  const at = new Date().toISOString();
  assert.equal(metricSchema.parse({ value: 0, unit: "percent", quality: "fresh", observedAt: at }).value, 0);
  assert.equal(metricSchema.parse({ value: null, unit: "percent", quality: "missing", observedAt: null }).value, null);
  assert.equal(metricSchema.safeParse({ value: 0, unit: "percent", quality: "missing", observedAt: null }).success, false);
  const evidence = { source: "zabbix", observedAt: null, basis: "unknown", token: "secret" };
  const target = hostSchema.parse({ hostKey: "one", name: "One", role: "unknown", availability: "unknown", metrics: {}, storages: [], filesystems: [], interfaces: [], vms: [], evidence, hostid: 7, token: "secret" });
  assert.equal(JSON.stringify(target).includes("secret"), false);
  const docker = containerSchema.parse({ reference: "opaque", hostKey: "one", name: "task", image: null, status: "running", health: "not_configured", metrics: {}, evidence, containerId: "private" });
  assert.equal(docker.containerId, undefined);
  assert.equal(docker.health, "not_configured");
});
test("snapshot freshness uses age or failure independently from TTL", () => {
  const now = Date.now(), updatedAt = new Date(now - 61000).toISOString();
  const batch = { snapshots: new Map([["k", { data: [], updatedAt, source: "zabbix", generation: randomUUID() }]]), sync: { status: "ok", lastSuccessfulAt: updatedAt, keys: ["k"] } };
  assert.equal(readResult([], batch, ["k"], now).stale, true);
  batch.snapshots.get("k").updatedAt = new Date(now).toISOString();
  assert.equal(readResult([], batch, ["k"], now).stale, false);
  batch.sync.status = "failed";
  assert.equal(readResult([], batch, ["k"], now).stale, true);
  assert.deepEqual(readResult([], { snapshots: new Map(), sync: null }, [], now), { data: [], availability: "no_data", stale: false, lastUpdated: null, refreshAfterMs: 20000 });
  const previous = process.env.SNAPSHOT_STALE_AFTER_MS;
  try { process.env.SNAPSHOT_STALE_AFTER_MS = "10000"; assert.throws(snapshotTiming); }
  finally { if (previous === undefined) delete process.env.SNAPSHOT_STALE_AFTER_MS; else process.env.SNAPSHOT_STALE_AFTER_MS = previous; }
});
