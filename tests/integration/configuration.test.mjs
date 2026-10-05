import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID, randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import pg from "pg";
import { createClient } from "redis";
import { withMigrationLock } from "../../docker/migration-lock.mjs";
import { runMigrationProcess } from "../../docker/migrate.mjs";
import { getPresentation, savePresentation, createResource, updateResource, deleteResource, getResource, listResources } from "../../lib/server/config/repository.ts";
import { getDatabase } from "../../lib/server/database.ts";
import { getPrisma } from "../../lib/server/prisma.ts";
import { sealEnvelope } from "../../lib/server/auth/envelope.ts";
import { initialPresentation } from "../../lib/config/presentation.ts";
import { publishSnapshots, markSyncFailure, readSnapshotBatch, snapshotKeys as keys } from "../../lib/server/cache/snapshots.ts";
import * as handlers from "../../lib/server/monitoring/handlers.ts";
import { opaqueReference } from "../../lib/server/zabbix/observations.ts";

let admin, cache, token, databaseCreated = false, leaseOwned = false;
const databaseName = "pulse_phase03_test_" + process.pid + "_" + Date.now();
const leaseKey = "pulse:test:phase03:lease", lease = randomUUID();
const touchedKeys = new Set();
const originalEnv = { DATABASE_URL: process.env.DATABASE_URL, REDIS_URL: process.env.REDIS_URL, TOKEN_ENCRYPTION_KEY: process.env.TOKEN_ENCRYPTION_KEY };
const originalFetch = globalThis.fetch;
const hostConfig = { resourceType: "host", zabbixHostKey: "asgard", dashboardEnabled: true };
const user = { id: 42, administrador: false, permissoes: [] };
const request = (path = "/", method = "GET", body, auth = token) => new Request("http://localhost/api" + path, {
  method, headers: { "Content-Type": "application/json", ...(auth ? { Authorization: "Bearer " + auth } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }),
});
const params = value => ({ params: Promise.resolve(value) });
const result = async response => ({ status: response.status, body: response.status === 204 ? null : await response.json() });
async function publish(entries, at) { for (const key of [...Object.keys(entries), keys.sync]) touchedKeys.add(key); return publishSnapshots(entries, at); }
async function clearSnapshots() { if (touchedKeys.size) await cache.del([...touchedKeys]); }
const at = () => new Date().toISOString();
const metric = value => ({ value, unit: "percent", observedAt: at(), quality: "fresh" });
const evidence = () => ({ source: "zabbix", observedAt: at(), basis: "item" });
const host = (hostKey = "asgard") => ({ hostKey, name: hostKey, role: "unknown", availability: "reachable", metrics: { cpuUsagePercent: metric(0) }, storages: [], filesystems: [], interfaces: [], vms: [], evidence: evidence() });
const container = (name = "evolution.1.a", hostKey = "asgard") => ({ reference: randomUUID(), hostKey, name, image: "example:1", status: "running", health: "not_configured", metrics: { cpuUsagePercent: metric(0) }, evidence: evidence(), containerId: "private-transient-id" });

before(async () => {
  const db = new URL(process.env.DATABASE_URL), redis = new URL(process.env.REDIS_URL);
  for (const target of [db, redis]) assert.ok(["127.0.0.1", "localhost", "[::1]"].includes(target.hostname), "Integration requires local services");
  db.pathname = "/postgres";
  admin = new pg.Client({ connectionString: db.href }); await admin.connect();
  await admin.query('CREATE DATABASE "' + databaseName + '"'); databaseCreated = true;
  db.pathname = "/" + databaseName; process.env.DATABASE_URL = db.href;
  await withMigrationLock({ connectionString: db.href, execute: signal => runMigrationProcess(signal) });
  redis.pathname = "/15"; process.env.REDIS_URL = redis.href;
  cache = createClient({ url: redis.href }); cache.on("error", () => {}); await cache.connect();
  assert.equal(await cache.set(leaseKey, lease, { NX: true, EX: 300 }), "OK", "Redis test DB 15 is in use"); leaseOwned = true;
  assert.equal(await cache.dbSize(), 1, "Redis DB 15 must be empty; no existing data will be deleted");
  process.env.TOKEN_ENCRYPTION_KEY = randomBytes(32).toString("base64");
  token = sealEnvelope({ type: "access", token: "test-only", user, sessionId: randomUUID(), expiresAt: Date.now() + 600000 });
  globalThis.fetch = () => { throw new Error("Monitoring must not call any upstream in this phase"); };
}, { timeout: 45000 });
after(async () => {
  globalThis.fetch = originalFetch;
  await globalThis.pulsePrisma?.$disconnect(); await globalThis.pulseDatabase?.end();
  if (globalThis.pulseCache?.isOpen) globalThis.pulseCache.destroy();
  if (cache?.isReady) {
    if (leaseOwned && await cache.get(leaseKey) === lease) { await clearSnapshots(); await cache.del(leaseKey); }
    await cache.quit();
  }
  if (admin) {
    assert.match(databaseName, /^pulse_phase03_test_\d+_\d+$/);
    if (databaseCreated) await admin.query('DROP DATABASE "' + databaseName + '" WITH (FORCE)');
    await admin.end();
  }
  for (const [key, value] of Object.entries(originalEnv)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
});

test("every business handler rejects missing, expired and refresh credentials before dependencies", async () => {
  const expired = sealEnvelope({ type: "access", token: "test", user, sessionId: randomUUID(), expiresAt: Date.now() - 1 });
  const refresh = sealEnvelope({ type: "refresh", token: "test", user, sessionId: randomUUID() });
  for (const handler of Object.values(handlers)) for (const auth of [null, expired, refresh, "tampered"]) {
    const response = await handler(request("/", "GET", undefined, auth), params({ id: randomUUID(), hostKey: "asgard", vmKey: "1" }));
    assert.equal(response.status, 401, handler.name);
    assert.deepEqual(await response.json(), { error: { code: "session_invalid" } });
    assert.equal(response.headers.get("cache-control"), "no-store");
  }
});
test("migrated schema contains only human configuration and host uniqueness includes NULL selectors", async () => {
  const a = await createResource(hostConfig);
  await assert.rejects(createResource(hostConfig), error => error.status === 409);
  const { rows } = await getDatabase().query("SELECT table_name FROM information_schema.tables WHERE table_schema='public' ORDER BY table_name");
  assert.deepEqual(rows.map(row => row.table_name), ["_prisma_migrations", "monitored_resource_config", "pulse_settings", "vm_template_config"]);
  const invalid = [
    [randomUUID(), "host", "zabbix", "other", "exact_name", "x", {}],
    [randomUUID(), "docker_container", "zabbix", "other", null, null, {}],
    [randomUUID(), "host", "other", "other", null, null, {}],
    [randomUUID(), "host", "zabbix", "other", null, null, { cpu: 55 }],
    [randomUUID(), "host", "zabbix", "other", null, null, { showHealth: true }],
    [randomUUID(), "host", "zabbix", "other", null, null, { showCpu: null }],
  ];
  for (const values of invalid) await assert.rejects(getDatabase().query('INSERT INTO monitored_resource_config(id,resource_type,source,zabbix_host_key,selector_type,selector_value,presentation) VALUES($1,$2,$3,$4,$5,$6,$7)', values), error => error.code === "23514");
  const concurrent = await Promise.allSettled([createResource({ ...hostConfig, zabbixHostKey: "concurrent" }), createResource({ ...hostConfig, zabbixHostKey: "concurrent" })]);
  assert.equal(concurrent.filter(item => item.status === "fulfilled").length, 1);
  assert.equal(concurrent.find(item => item.status === "rejected").reason.status, 409);
  assert.equal((await getResource(a.id)).zabbixHostKey, "asgard");
});
test("presentation initialization is idempotent across clients and revision comparison is atomic", async () => {
  const results = await Promise.all(Array.from({ length: 4 }, getPresentation));
  for (const value of results) assert.deepEqual(value, results[0]);
  const { revision, ...settings } = results[0].data;
  settings.rotation.intervalSeconds = 30;
  settings.screens.push(initialPresentation(randomUUID).screens[0]);
  settings.rotation.autoStart = true;
  const writes = await Promise.allSettled([savePresentation({ expectedRevision: revision, settings }), savePresentation({ expectedRevision: revision, settings })]);
  assert.equal(writes.filter(item => item.status === "fulfilled").length, 1);
  assert.equal(writes.find(item => item.status === "rejected").reason.code, "revision_conflict");
  const saved = await getPresentation();
  assert.equal(saved.data.revision, revision + 1); assert.equal(saved.data.rotation.intervalSeconds, 30);
  await getPrisma().$disconnect(); delete globalThis.pulsePrisma;
  assert.deepEqual(await getPresentation(), saved);
});
test("CRUD HTTP contracts preserve untouched fields, reject unknown writes and keep UUID ordering", async () => {
  const post = await result(await handlers.servicePost(request("/monitoring/services", "POST", { resourceType: "docker_container", zabbixHostKey: "asgard", selectorType: "name_prefix", selectorValue: "evolution", displayOrder: 4, dashboardEnabled: true })));
  assert.equal(post.status, 201);
  const id = post.body.data.id;
  const patched = await result(await handlers.servicePatch(request("/", "PATCH", { displayName: "Evolution" }), params({ id })));
  assert.equal(patched.status, 200); assert.equal(patched.body.data.displayOrder, 4); assert.equal(patched.body.data.dashboardEnabled, true);
  assert.equal((await handlers.servicePatch(request("/", "PATCH", { cpu: 0 }), params({ id }))).status, 400);
  assert.equal((await handlers.servicePatch(request("/", "PATCH", { selectorType: "regex", selectorValue: "[" }), params({ id }))).status, 400);
  assert.equal((await handlers.serviceGet(request(), params({ id: "not-uuid" }))).status, 400);
  assert.equal((await handlers.serviceDelete(request("/", "DELETE"), params({ id: randomUUID() }))).status, 404);
  assert.equal((await handlers.servicePost(request("/", "POST", { ...hostConfig, displayOrder: -1 }))).status, 400);
  const configs = await listResources();
  assert.deepEqual(configs.map(item => item.id), [...configs].sort((a,b) => a.displayOrder - b.displayOrder || a.id.localeCompare(b.id)).map(item => item.id));
  assert.equal((await handlers.serviceDelete(request("/", "DELETE"), params({ id }))).status, 204);
});
test("presentation validates references and DELETE repairs every affected screen in one transaction", async () => {
  const config = await createResource({ ...hostConfig, zabbixHostKey: "presentation-target" });
  let { data: current } = await getPresentation();
  const settings = { ...current }; delete settings.revision;
  for (const screen of settings.screens) screen.blocks = [{ id: randomUUID(), type: "resource_card", enabled: true, width: "wide", resourceConfigId: config.id }];
  const saved = await savePresentation({ expectedRevision: current.revision, settings });
  await updateResource(config.id, { enabled: false });
  const disabled = await (await handlers.overviewGet(request("/dashboard/overview"))).json();
  assert.equal(disabled.data.blocks[0].availability, "unavailable"); assert.equal(disabled.data.blocks[0].data, null);
  await assert.rejects(savePresentation({ expectedRevision: saved.data.revision, settings }), error => error.code === "invalid_resource_reference");
  await deleteResource(config.id);
  current = (await getPresentation()).data;
  assert.equal(current.revision, saved.data.revision + 1);
  for (const screen of current.screens) { assert.equal(screen.blocks.length, 1); assert.equal(screen.blocks[0].type, "summary"); }
  const missingRef = structuredClone(settings); missingRef.screens[0].blocks[0].resourceConfigId = randomUUID();
  await assert.rejects(savePresentation({ expectedRevision: current.revision, settings: missingRef }), error => error.status === 400);
});
test("concurrent presentation save and resource deletion never leave a dangling reference", async () => {
  const config = await createResource({ ...hostConfig, zabbixHostKey: "race-target" });
  const { revision, ...settings } = (await getPresentation()).data;
  settings.screens[0].blocks = [{ id: randomUUID(), type: "resource_card", enabled: true, width: "full", resourceConfigId: config.id }];
  const outcomes = await Promise.allSettled([savePresentation({ expectedRevision: revision, settings }), deleteResource(config.id)]);
  assert.equal(outcomes[1].status, "fulfilled");
  assert.ok(!(await getPresentation()).data.screens.some(screen => screen.blocks.some(block => block.resourceConfigId === config.id)));
});
test("empty authenticated reads use stable unknown states and unknown details return 404", async () => {
  await clearSnapshots();
  for (const handler of [handlers.hostsGet, handlers.containersGet, handlers.problemsGet]) {
    const response = await result(await handler(request()));
    assert.equal(response.status, 200); assert.deepEqual(response.body, { data: [], availability: "no_data", stale: false, lastUpdated: null, refreshAfterMs: 20000 });
  }
  const overview = await result(await handlers.overviewGet(request()));
  assert.equal(overview.status, 200); assert.equal(overview.body.availability, "no_data");
  assert.ok(Object.values(overview.body.data.summary).every(value => value === null));
  assert.equal(overview.body.data.blocks[0].availability, "no_data");
  assert.equal((await handlers.overviewGet(request("/?screenId=bad"))).status, 400);
  assert.equal((await handlers.overviewGet(request("/?screenId=" + randomUUID()))).status, 404);
  assert.equal((await handlers.hostGet(request(), params({ hostKey: "missing" }))).status, 404);
  assert.equal((await handlers.vmHistoryGet(request(), params({ hostKey: "missing", vmKey: "1" }))).status, 404);
  const config = (await listResources())[0];
  const detail = await (await handlers.serviceGet(request(), params({ id: config.id }))).json();
  assert.equal(detail.data.resolution, "missing"); assert.equal(detail.data.config.id, config.id);
  const history = await (await handlers.serviceHistoryGet(request("/?range=7d"), params({ id: config.id }))).json();
  assert.deepEqual(history.data.series, []); assert.equal(history.data.source, "trends");
});
test("snapshots are atomic, disposable and normalized without leaking technical IDs", async () => {
  const vm = { vmKey: "vm-101", vmId: "101", name: "Agentless VM", parentHostKey: "asgard", linuxHostKey: null, state: "running", metrics: {}, evidence: evidence() };
  const target = host(); target.vms.push(vm);
  await publish({ [keys.hosts]: [target, host("second")], [keys.containers("asgard")]: [container()], [keys.containers("second")]: [container("evolution.1.a", "second")], [keys.problems]: [] });
  const hosts = await (await handlers.hostsGet(request())).json();
  assert.equal(hosts.availability, "ready"); assert.equal(hosts.data[0].metrics.cpuUsagePercent.value, 0);
  const containers = await (await handlers.containersGet(request())).json();
  assert.equal(containers.data.length, 2); assert.equal(JSON.stringify(containers).includes("private-transient-id"), false);
  const history = await (await handlers.vmHistoryGet(request("/?range=24h"), params({ hostKey: "asgard", vmKey: "vm-101" }))).json();
  assert.deepEqual(history.data.series, []); assert.equal(history.data.resource.reference, "vm-101");
  assert.equal((await handlers.vmHistoryGet(request(), params({ hostKey: "asgard", vmKey: "missing" }))).status, 404);
  assert.equal((await handlers.hostHistoryGet(request("/?range=invalid"), params({ hostKey: "asgard" }))).status, 400);
  const config = await createResource({ resourceType: "docker_container", zabbixHostKey: "asgard", selectorType: "name_prefix", selectorValue: "evolution", dashboardEnabled: true });
  let service = await (await handlers.serviceGet(request(), params({ id: config.id }))).json(); assert.equal(service.data.resolved, true);
  await publish({ [keys.hosts]: [target], [keys.containers("asgard")]: [container(), container("evolution.2.b")] });
  service = await (await handlers.serviceGet(request(), params({ id: config.id }))).json(); assert.equal(service.data.resolution, "ambiguous");
  await assert.rejects(createResource({ resourceType: "docker_container", zabbixHostKey: "asgard", selectorType: "name_contains", selectorValue: "evolution" }), error => error.code === "selector_ambiguous");
  await updateResource(config.id, { displayName: "Still editable while ambiguous" });
  const ttl = await cache.ttl(keys.hosts); assert.ok(ttl > 290 && ttl <= 300);
  await clearSnapshots(); assert.equal((await getResource(config.id)).id, config.id);
  await deleteResource(config.id);
});
test("stale uses collector failure, old cycle and individual evidence age; mixed generations are rejected", async () => {
  const target = host(); target.metrics.cpuUsagePercent.observedAt = new Date(Date.now() - 120000).toISOString();
  await publish({ [keys.hosts]: [target] });
  let response = await (await handlers.hostsGet(request())).json();
  assert.equal(response.stale, false); assert.equal(response.data[0].metrics.cpuUsagePercent.quality, "stale");
  await markSyncFailure(); response = await (await handlers.hostsGet(request())).json(); assert.equal(response.stale, true);
  await publish({ [keys.hosts]: [host()] }, new Date(Date.now() - 61000).toISOString());
  response = await (await handlers.hostsGet(request())).json(); assert.equal(response.stale, true);
  const envelope = JSON.parse(await cache.get(keys.hosts)); envelope.generation = randomUUID(); await cache.set(keys.hosts, JSON.stringify(envelope));
  await assert.rejects(readSnapshotBatch([keys.hosts]), error => error.code === "snapshot_inconsistent");
  assert.equal((await handlers.hostsGet(request())).status, 503);
  await clearSnapshots();
});
test("Redis outage returns sanitized 503 while presentation can still be saved in PostgreSQL", async () => {
  if (globalThis.pulseCache?.isOpen) globalThis.pulseCache.destroy(); delete globalThis.pulseCache;
  const previous = process.env.REDIS_URL; process.env.REDIS_URL = "redis://127.0.0.1:1";
  try {
    const response = await result(await handlers.hostsGet(request())); assert.equal(response.status, 503);
    assert.deepEqual(response.body, { error: { code: "cache_unavailable" } });
    const { revision, ...settings } = (await getPresentation()).data;
    assert.equal((await savePresentation({ expectedRevision: revision, settings })).data.revision, revision + 1);
  } finally { process.env.REDIS_URL = previous; }
});

test("overview reads only visible resource inventories and never enables hidden metrics", async () => {
  const first = await createResource({ resourceType: "docker_container", zabbixHostKey: "first", selectorType: "exact_name", selectorValue: "task", dashboardEnabled: true, presentation: { showCpu: false, showStatus: false } });
  const second = await createResource({ resourceType: "docker_container", zabbixHostKey: "second", selectorType: "exact_name", selectorValue: "task", dashboardEnabled: true });
  const { revision, ...settings } = (await getPresentation()).data;
  settings.rotation.autoStart = false;
  settings.screens[0].blocks = [{ id: randomUUID(), type: "resource_card", enabled: true, width: "standard", resourceConfigId: first.id }];
  settings.screens[1].blocks = [{ id: randomUUID(), type: "resource_card", enabled: true, width: "standard", resourceConfigId: second.id }];
  await savePresentation({ expectedRevision: revision, settings });
  await publish({ [keys.hosts]: [host("first"), host("second")], [keys.containers("first")]: [container("task", "first")], [keys.containers("second")]: "invalid data on a hidden screen" });
  const response = await result(await handlers.overviewGet(request("/?screenId=" + settings.screens[0].id)));
  assert.equal(response.status, 200); assert.equal(response.body.data.highlightedResources.length, 1);
  const card = response.body.data.blocks[0].data;
  assert.deepEqual(card.metrics, {}); assert.deepEqual(card.resource.metrics, {}); assert.equal(card.resource.status, "unknown"); assert.equal(card.resource.health, "unknown");
  await updateResource(first.id, { dashboardEnabled: false });
  const hidden = await (await handlers.overviewGet(request("/?screenId=" + settings.screens[0].id))).json();
  assert.equal(hidden.data.blocks[0].availability, "unavailable"); assert.equal(hidden.data.blocks[0].data, null);
  await clearSnapshots(); await deleteResource(first.id); await deleteResource(second.id);
});
test("unimplemented blocks cannot be selected and stored future blocks report unavailable", async () => {
  const { revision, ...settings } = (await getPresentation()).data;
  settings.rotation.autoStart = false;
  settings.screens[0].blocks = [{ id: randomUUID(), type: "host_inventory", enabled: true, width: "full" }];
  await assert.rejects(savePresentation({ expectedRevision: revision, settings }), error => error.code === "block_unavailable");
  await getPrisma().pulseSetting.update({ where: { key: "dashboardPresentation" }, data: { value: { ...settings, revision: revision + 1 } } });
  const overview = await (await handlers.overviewGet(request())).json();
  assert.equal(overview.data.blocks[0].availability, "unavailable"); assert.equal(overview.data.blocks[0].data, null);
});

function templateFixture(templateId = "900") {
  const machine = (name, id) => ({ vmKey: opaqueReference("vm", "asgard", "qemu/" + id), vmId: id, name, parentHostKey: "asgard", linuxHostKey: null, state: "stopped", metrics: { memoryTotalBytes: { ...metric(4096), unit: "bytes" } }, evidence: evidence() });
  const target = host(), template = machine("tpl-worker-ubuntu-24", templateId), vm = machine("vm-operacao", "101");
  target.vms = [template, vm];
  target.metrics.memoryTotalBytes = { ...metric(32768), unit: "bytes" };
  target.storages = [{ key: "storage", name: "local", metrics: { diskUsedBytes: { ...metric(5000), unit: "bytes" } } }];
  const problems = [template, vm].map((machine, i) => ({ id: "problem-" + i, resource: { type: "vm", hostKey: "asgard", reference: machine.vmKey }, description: `Proxmox VE: VM [asgard/${machine.name} (qemu/${machine.vmId})]: Not running`, severity: 2, visualState: "warning", startedAt: at() }));
  const summary = { hostsKnown: 1, hostsReachable: 1, vms: 2, containersRunning: null, containersStopped: null, containersTotal: null, problems: 2, criticalAffected: 0 };
  return { target, template, vm, entries: { [keys.hosts]: [target], [keys.host("asgard")]: target, [keys.problems]: problems, [keys.overview]: { summary, asgardSummary: { host: target, vms: target.vms } } } };
}
test("BFF separates templates and correlated problems while retaining raw snapshots and all ASGARD capacity", async () => {
  const fixture = templateFixture(); await publish(fixture.entries);
  const before = await cache.get(keys.hosts);
  const overview = await (await handlers.overviewGet(request())).json();
  assert.equal(overview.data.summary.vms, 1); assert.equal(overview.data.summary.problems, 1);
  assert.deepEqual(overview.data.asgardSummary.vms.map(vm => vm.vmId), ["101"]);
  assert.equal(overview.data.asgardSummary.host.metrics.memoryTotalBytes.value, 32768);
  assert.equal(overview.data.asgardSummary.host.storages[0].metrics.diskUsedBytes.value, 5000);
  for (const response of [await handlers.hostsGet(request()), await handlers.hostGet(request(), params({ hostKey: "asgard" }))]) {
    const { data } = await response.json(); const target = Array.isArray(data) ? data[0] : data;
    assert.equal(target.vms.length, 1); assert.equal(target.metrics.memoryTotalBytes.value, 32768);
  }
  const problems = await (await handlers.problemsGet(request())).json();
  assert.equal(problems.data.length, 1); assert.equal(problems.data[0].displayDescription, "vm-operacao (101) · Not running");
  assert.match(problems.data[0].description, /^Proxmox VE:/);
  const templates = await (await handlers.templatesGet(request("/?hostKey=asgard"))).json();
  assert.equal(templates.data.length, 1); assert.equal(templates.data[0].role, "worker"); assert.equal(templates.data[0].virtualizationType, "qemu");
  assert.equal(templates.data[0].memoryBytes.value, 4096);
  for (const key of ["virtualCpuCount", "diskBytes", "operatingSystem", "configuration"]) assert.equal(templates.data[0][key], null);
  assert.equal(await cache.get(keys.hosts), before);
  assert.equal((await handlers.templatesGet(request("/?unknown=1"))).status, 400);
  assert.equal((await handlers.templateGet(request(), params({ templateKey: fixture.template.vmKey }))).status, 200);
  assert.equal((await handlers.vmHistoryGet(request(), params({ hostKey: "asgard", vmKey: fixture.template.vmKey }))).status, 404);
});
test("template labels have atomic revision, immutable identity and survive reconnect and disappearance", async () => {
  const fixture = templateFixture("901"), templateKey = fixture.template.vmKey;
  await publish(fixture.entries);
  const input = { expectedRevision: 0, displayName: "Worker Ubuntu 24.04", roleOverride: "manager" };
  const writes = await Promise.all([1, 2].map(() => handlers.templateConfigPut(request("/", "PUT", input), params({ templateKey }))));
  assert.deepEqual(writes.map(response => response.status).sort(), [200, 409]);
  const saved = (await writes.find(response => response.status === 200).json()).data;
  assert.equal(saved.revision, 1); assert.equal(saved.originalName, fixture.template.name); assert.equal(saved.hostKey, "asgard");
  const resolved = (await (await handlers.templateGet(request(), params({ templateKey }))).json()).data;
  assert.equal(resolved.displayName, input.displayName); assert.equal(resolved.technicalName, fixture.template.name);
  assert.equal(resolved.role, "manager"); assert.equal(resolved.roleSource, "configuration");
  assert.equal((await handlers.templateConfigPut(request("/", "PUT", { ...input, expectedRevision: 1, memoryBytes: 10 }), params({ templateKey }))).status, 400);
  assert.equal((await handlers.templateConfigPut(request("/", "PUT", { ...input, expectedRevision: 1, hostKey: "other" }), params({ templateKey }))).status, 400);
  await getPrisma().$disconnect(); delete globalThis.pulsePrisma;
  assert.deepEqual((await (await handlers.templateConfigsGet(request())).json()).data.find(row => row.templateKey === templateKey), saved);
  await clearSnapshots();
  const changed = await result(await handlers.templateConfigPut(request("/", "PUT", { expectedRevision: 1, displayName: null, roleOverride: null }), params({ templateKey })));
  assert.equal(changed.status, 200); assert.equal(changed.body.data.revision, 2);
  assert.equal((await handlers.templateGet(request(), params({ templateKey }))).status, 404);
  assert.equal((await (await handlers.templateConfigsGet(request())).json()).data.some(row => row.templateKey === templateKey), true);
  await publish(fixture.entries);
  const returned = (await (await handlers.templateGet(request(), params({ templateKey }))).json()).data;
  assert.equal(returned.displayName, fixture.template.name); assert.equal(returned.role, "worker"); assert.equal(returned.configuration.revision, 2);
  const columns = (await getDatabase().query("SELECT column_name FROM information_schema.columns WHERE table_name='vm_template_config'")).rows.map(row => row.column_name);
  for (const forbidden of ["cpu", "memory_bytes", "disk_bytes", "status", "operating_system"]) assert.equal(columns.includes(forbidden), false);
});
test("new template configuration requires current discovery and never accepts a normal VM", async () => {
  const fixture = templateFixture("902"), input = { expectedRevision: 0, displayName: null, roleOverride: null };
  await publish(fixture.entries);
  assert.equal((await handlers.templateConfigPut(request("/", "PUT", input), params({ templateKey: fixture.vm.vmKey }))).status, 404);
  assert.equal((await handlers.templateConfigPut(request("/", "PUT", input), params({ templateKey: "invalid" }))).status, 400);
  await markSyncFailure();
  const response = await result(await handlers.templateConfigPut(request("/", "PUT", input), params({ templateKey: fixture.template.vmKey })));
  assert.equal(response.status, 409); assert.equal(response.body.error.code, "template_inventory_unavailable");
  const stale = await (await handlers.templatesGet(request())).json(); assert.equal(stale.stale, true); assert.equal(stale.data[0].memoryBytes.quality, "stale");
  assert.equal((await (await handlers.templateConfigsGet(request())).json()).data.some(row => row.templateKey === fixture.template.vmKey), false);
});

test("dashboard layout migration reorders only the untouched initial composition and preserves IDs and custom choices", async () => {
  const sql = await readFile(new URL("../../prisma/migrations/20261003103000_dashboard_layout/migration.sql", import.meta.url), "utf8");
  const legacy = initialPresentation(randomUUID);
  const blocks = legacy.screens[0].blocks;
  legacy.revision = 7;
  legacy.screens[0].blocks = ["summary", "highlighted_resources", "problems", "asgard_summary"].map(type => ({ ...blocks.find(block => block.type === type), width: "full" }));
  const write = value => getDatabase().query("UPDATE pulse_settings SET value=$1::jsonb WHERE key='dashboardPresentation'", [JSON.stringify(value)]);
  await write(legacy); await getDatabase().query(sql);
  const migrated = (await getPresentation()).data;
  assert.equal(migrated.revision, 8); assert.equal(migrated.screens[0].id, legacy.screens[0].id);
  assert.deepEqual(migrated.screens[0].blocks.map(block => block.type), ["summary", "asgard_summary", "problems", "highlighted_resources"]);
  for (const block of migrated.screens[0].blocks) assert.equal(block.id, legacy.screens[0].blocks.find(item => item.type === block.type).id);
  await getDatabase().query(sql); assert.deepEqual((await getPresentation()).data, migrated);
  for (const customize of [value => { value.screens[0].name = "Minha tela"; }, value => { value.screens[0].blocks.reverse(); }, value => { value.screens[0].blocks[1].width = "wide"; }, value => { value.rotation.intervalSeconds = 30; }]) {
    const custom = structuredClone(legacy); customize(custom); await write(custom); await getDatabase().query(sql);
    assert.deepEqual((await getPresentation()).data, custom);
  }
});

test("compact dashboard migration places highlights above two panels and preserves personal layouts", async () => {
  const sql = await readFile(new URL("../../prisma/migrations/20261003120000_compact_dashboard/migration.sql", import.meta.url), "utf8");
  const previous = initialPresentation(randomUUID), blocks = previous.screens[0].blocks;
  previous.revision = 8;
  previous.screens[0].blocks = [["summary", "full"], ["asgard_summary", "full"], ["problems", "wide"], ["highlighted_resources", "standard"]].map(([type, width]) => ({ ...blocks.find(block => block.type === type), width }));
  const write = value => getDatabase().query("UPDATE pulse_settings SET value=$1::jsonb WHERE key='dashboardPresentation'", [JSON.stringify(value)]);
  await write(previous); await getDatabase().query(sql);
  const migrated = (await getPresentation()).data;
  assert.equal(migrated.revision, 9);
  assert.deepEqual(migrated.screens[0].blocks.map(({type, width}) => ({type, width})), blocks.map(({type, width}) => ({type, width})));
  for (const block of migrated.screens[0].blocks) assert.equal(block.id, blocks.find(item => item.type === block.type).id);
  await getDatabase().query(sql); assert.deepEqual((await getPresentation()).data, migrated);
  for (const customize of [value => { value.screens[0].name = "Minha tela"; }, value => { value.screens[0].blocks.reverse(); }, value => { value.screens[0].blocks[1].width = "wide"; }, value => { value.rotation.intervalSeconds = 30; }]) {
    const custom = structuredClone(previous); customize(custom); await write(custom); await getDatabase().query(sql);
    assert.deepEqual((await getPresentation()).data, custom);
  }
});
