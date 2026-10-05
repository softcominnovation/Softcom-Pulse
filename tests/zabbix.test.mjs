import test from "node:test";
import assert from "node:assert/strict";
import { setTimeout as delay } from "node:timers/promises";
import { zabbixFixture } from "./fixtures/zabbix.mjs";
import { collectSnapshots } from "../lib/server/zabbix/collect.ts";
import { normalizeInventory, normalizeProblems, summarize } from "../lib/server/zabbix/normalize.ts";
import { observationContext } from "../lib/server/zabbix/observations.ts";
import { selectScope, monitoringScopeSchema } from "../lib/server/zabbix/scope.ts";
import { sourceKey } from "../lib/server/zabbix/bindings.ts";
import { metricRule } from "../lib/server/zabbix/mapping.ts";
import { queryHistory, discreteSeries } from "../lib/server/zabbix/history.ts";
import { createCycle } from "../collector/worker.ts";
import { freshness } from "../lib/server/monitoring/inventory.ts";

function normalize(f) { return normalizeInventory(f.hosts.slice(0, 2), f.items, "ASGARD", f.scope.scope.vmLinks, f.now); }

test("scope never includes every visible host and never correlates by display name", () => {
  const f = zabbixFixture();
  assert.deepEqual(selectScope(f.hosts, f.scope).hosts.map(h => h.host), ["ASGARD", "linux-a"]);
  assert.deepEqual(selectScope(f.hosts, { scope: null, asgardHostKey: null }).hosts.map(h => h.host), ["ASGARD"]);
  const n = normalize(f);
  assert.equal(n.hosts[0].vms[0].linuxHostKey, "linux-a");
  assert.equal(n.hosts[0].vms[1].linuxHostKey, null);
  assert.notEqual(n.hosts[0].vms[0].name, "linux-a");
  assert.equal(n.hosts[0].vms[0].parentHostKey, "ASGARD");
  assert.match(n.hosts[0].vms[0].vmKey, /^vm-[a-f0-9]{32}$/);
  assert.throws(() => selectScope(f.hosts.slice(1), f.scope), /scope/);
  assert.equal(monitoringScopeSchema.safeParse({ ...f.scope.scope, hostKeys: ["ASGARD"] }).success, false);
});
test("real template units preserve zero and distinguish CPU idle, rates and unsupported metrics", () => {
  const n = normalize(zabbixFixture());
  assert.equal(n.hosts[0].metrics.cpuUsagePercent.value, 0);
  assert.equal(n.hosts[1].metrics.cpuUsagePercent.value, 25);
  assert.equal(n.containers[0].metrics.cpuUsagePercent.value, 50);
  assert.equal(n.containers[0].metrics.networkReceiveBitsPerSecond.value, 80);
  assert.equal(n.containers[0].metrics.memoryUsedBytes.quality, "unsupported");
  assert.equal(n.containers[0].metrics.memoryUsedBytes.value, null);
  assert.equal(n.hosts[1].availability, "unknown", "host.status is not availability");
  const f = zabbixFixture();
  const counter = f.items.find(i => i.key_.startsWith("docker.networks.rx_bytes"));
  assert.equal(metricRule({ ...counter, preprocessing: [] }), null, "an accumulated counter cannot become a rate");
});
test("unchanged values use heartbeat and master evidence, without refreshing an old observation", () => {
  const f = zabbixFixture(), n = normalize(f);
  assert.equal(n.hosts[0].metrics.memoryTotalBytes.quality, "fresh");
  assert.equal(n.hosts[0].metrics.memoryUsagePercent.value, 50);
  assert.equal(n.containers[0].status, "running");
  const item = f.items.find(i => i.key_.startsWith("docker.container_info.state.status"));
  assert.ok(Date.parse(observationContext(f.items, f.now).evidence(item).observedAt) < f.now - 60000);
  for (const i of f.items) if (i.hostid === "2") i.lastclock = String(Math.floor(f.now / 1000) - 7200);
  assert.equal(normalize(f).containers[0].status, "unknown");
  assert.equal(freshness(n.containers, false, f.now + 1000000)[0].health, "unknown");
  assert.equal(freshness(n.hosts, true, f.now)[0].availability, "unknown");
});
test("Docker health maps only verified values and is independent from process state", () => {
  for (const [raw, expected] of [[1, "starting"], [2, "unhealthy"], [3, "healthy"], [4, "not_configured"]]) {
    const f = zabbixFixture(); f.items.find(i => i.key_.startsWith("docker.container_info.state.health[")).lastvalue = String(raw);
    const c = normalize(f).containers[0]; assert.equal(c.health, expected); assert.equal(c.status, "running");
  }
  for (const scenario of ["absent", "unsupported", "stale", "wrong_map"]) {
    const f = zabbixFixture(), health = f.items.find(i => i.key_.startsWith("docker.container_info.state.health["));
    if (scenario === "absent") f.items.splice(f.items.indexOf(health), 1);
    if (scenario === "unsupported") health.state = "1";
    if (scenario === "stale") health.lastclock = "1";
    if (scenario === "wrong_map") health.valuemap = [];
    assert.equal(normalize(f).containers[0].health, "unknown", scenario);
  }
});
test("container identity changes on redeployment and lost discovery leaves the next generation", () => {
  const f = zabbixFixture(), first = normalize(f).containers[0];
  assert.equal(first.name, "service.1.abc");
  f.items.find(i => i.key_.startsWith("docker.container_info.created[")).lastvalue = "1700000100";
  assert.notEqual(normalize(f).containers[0].reference, first.reference);
  for (const item of f.items) if (item.tags.some(t => t.tag === "container")) item.itemDiscovery = { status: "1" };
  assert.deepEqual(normalize(f).containers, []);
});
test("overview Docker totals use aggregate items even when stopped containers are absent from discovery", () => {
  const f = zabbixFixture(), n = normalize(f), p = normalizeProblems(f.problems, f.triggers, n);
  assert.equal(n.containers.length, 1);
  assert.equal(p[0].resource.type, "docker_container");
  assert.equal(summarize(n, p, 0).containersStopped, 4);
  assert.equal(summarize(n, p, 0).containersTotal, 5);
  f.items.find(i => i.key_ === "docker.containers.stopped").state = "1";
  assert.equal(summarize(normalize(f), p, 0).containersStopped, null);
});
test("collection uses a fixed number of batches, never fetches raw master values, and validates whole cycles", async () => {
  const f = zabbixFixture();
  const result = await collectSnapshots({ rpc: f.rpc, scope: f.scope, configs: [], now: f.now });
  assert.deepEqual(result.counts, { hosts: 2, vms: 2, containers: 1, problems: 1 });
  assert.deepEqual(f.calls.map(c => c.method), ["host.get", "item.get", "item.get", "problem.get", "trigger.get"]);
  const values = f.calls[2].params.itemids;
  assert.ok(!f.items.filter(i => i.lastvalue.startsWith("DO_NOT_")).some(i => values.includes(i.itemid)));
  assert.ok(!JSON.stringify(result.entries).includes("DO_NOT_"));
  assert.ok(result.entries["pulse:source:bindings"]);
  await assert.rejects(collectSnapshots({ rpc: async (m, p) => m === "item.get" && p.itemids ? [] : f.rpc(m, p), scope: f.scope, configs: [] }), /incomplete/);
});
test("concurrent cycles share one execution; partial failure never publishes and records only a safe code", async () => {
  let collected = 0, published = 0, failed;
  const run = createCycle({ collect: async () => { collected++; await delay(20); return { entries: { a: 1 } }; }, publish: async () => { published++; }, fail: async code => { failed = code; } });
  const first = run(); assert.equal(run(), first); assert.equal(await first, true); assert.equal(collected, 1); assert.equal(published, 1);
  const bad = createCycle({ collect: async () => { throw new Error("SECRET_URL_TOKEN"); }, publish: async () => { published++; }, fail: async code => { failed = code; } });
  assert.equal(await bad(), false); assert.equal(published, 1); assert.equal(failed, "collection_failed");
  const stop = new AbortController(); stop.abort(); assert.equal(await run(stop.signal), false); assert.equal(published, 1);
});
test("long numeric history uses trends while health and state use typed history batches", async () => {
  const f = zabbixFixture(), n = normalize(f), c = n.containers[0];
  const result = await queryHistory({ type: "docker_container", hostKey: c.hostKey, reference: c.reference }, "7d", n.bindings[sourceKey("docker_container", c.hostKey, c.reference)], { rpc: f.rpc, now: f.now });
  assert.ok(f.calls.some(c => c.method === "trend.get"));
  assert.ok(f.calls.filter(c => c.method === "history.get").every(c => c.params.history === 0 || c.params.history === 1));
  const raw = JSON.stringify(result);
  assert.ok(!raw.includes('"itemid"')); assert.ok(!raw.includes('"hostid"'));
  assert.ok(result.data.series.every(s => s.points.length <= 1000));
  assert.ok(result.data.states.length === 2);
  assert.equal(result.data.technicalReference, c.reference);
});
test("discrete history carries prior state only through its supported interval and preserves incidents in buckets", () => {
  const binding = { kind: "health", maxGapSeconds: 50 };
  const carried = discreteSeries(binding, [{ clock: "90", value: "3" }, { clock: "180", value: "2" }], 100, 220, false);
  assert.equal(carried.segments[0].state, "healthy"); assert.equal(carried.segments[0].observedAt, new Date(90000).toISOString());
  assert.ok(carried.segments.some(s => s.state === "unknown")); assert.ok(carried.segments.some(s => s.state === "unhealthy"));
  const many = Array.from({ length: 4000 }, (_, i) => ({ clock: String(i), value: i % 2 ? "3" : "2" }));
  const reduced = discreteSeries(binding, many, 0, 4000, false);
  assert.equal(reduced.segments.length, 1000); assert.ok(reduced.segments.every(s => s.state === "unhealthy"));
});

test("an event-only status cannot bridge a monitoring outage without master evidence", () => {
  const binding = { kind: "status", maxGapSeconds: 3600, proof: { itemid: "2", valueType: "3", maxGapSeconds: 60 } };
  const series = discreteSeries(binding, [{ clock: "90", value: "running" }], 100, 300, false, [{ clock: "100", value: "1" }, { clock: "250", value: "1" }]);
  assert.deepEqual(series.segments.map(s => s.state), ["running", "unknown", "running"]);
  assert.equal(series.coverageLimited, true);
});

test("presentation preferences cannot hide critical state from overview aggregation", async () => {
  const f = zabbixFixture();
  const config = { id: "00000000-0000-4000-8000-000000000001", resourceType: "host", source: "zabbix", zabbixHostKey: "ASGARD", selectorType: null, selectorValue: null, enabled: true, dashboardEnabled: true, critical: true, presentation: { showStatus: false, showCpu: true } };
  const result = await collectSnapshots({ rpc: f.rpc, scope: f.scope, configs: [config], now: f.now });
  assert.equal(result.entries["pulse:snapshot:overview"].summary.criticalAffected, 0);
  assert.equal(result.entries["pulse:snapshot:service:" + config.id].resource.availability, "unknown");
});

test("history pages by time without exposing technical ids and rejects invalid upstream rows", async () => {
  const now = 1790980000000, till = now / 1000;
  const binding = { key: "cpuUsagePercent", itemid: "1", valueType: "0", unit: "percent", scale: 1, offset: 0, kind: "numeric", maxGapSeconds: 135, quality: "fresh", observedAt: new Date(now).toISOString() };
  const resource = { type: "host", hostKey: "ASGARD", reference: null }, source = { identity: "host-test", bindings: [binding] };
  const requests = [];
  const rpc = async (_method, params) => { requests.push(params); return requests.length === 1 ? Array.from({ length: 5000 }, (_, i) => ({ itemid: "1", clock: String(till - Math.floor(i / 3)), ns: String(i % 3), value: "25" })) : [{ itemid: "1", clock: String(till - 1700), ns: "0", value: "0" }]; };
  const result = await queryHistory(resource, "1h", source, { rpc, now });
  assert.equal(requests.length, 2); assert.ok(requests[1].time_till < requests[0].time_till);
  assert.ok(result.data.series[0].points.length <= 1000); assert.ok(result.data.series[0].points.some(p => p.min === 0));
  await assert.rejects(queryHistory(resource, "1h", source, { rpc: async () => [{ secret: "invalid-response" }], now }), error => error.status === 503 && error.code === "zabbix_history_invalid");
});
