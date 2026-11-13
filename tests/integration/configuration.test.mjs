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
import { initialPresentation as initialV2, effectiveOptions } from "../../lib/config/presentation.ts";
import { publicGet } from "../../lib/server/monitoring/public-handlers.ts";
function initialPresentation(newId) { const document = initialV2(newId); document.schemaVersion = 1; document.screens.forEach(screen => screen.blocks.forEach(block => { delete block.options; })); return document; }
import { publishSnapshots, markSyncFailure, readSnapshotBatch, readResult, snapshotKeys as keys } from "../../lib/server/cache/snapshots.ts";
import * as handlers from "../../lib/server/monitoring/handlers.ts";
import { opaqueReference } from "../../lib/server/zabbix/observations.ts";
import { saveVmConfig, listVmConfigs } from "../../lib/server/config/vms.ts";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { runProbeCycle } from "../../lib/server/probe/cycle.ts";
import { listEnabledExternalServices, purgeExternalSamples } from "../../lib/server/probe/repository.ts";
import { probeKeys } from "../../lib/server/probe/store.ts";
import { runVpsMonitorCycle } from "../../lib/server/vps/cycle.ts";
import { listEnabledMonitoredVps, purgeVpsSamples } from "../../lib/server/vps/repository.ts";
import { vpsResultKey } from "../../lib/server/vps/store.ts";
import { runSignalMonitorCycle } from "../../lib/server/signal/cycle.ts";
import { purgeSignalSamples } from "../../lib/server/signal/repository.ts";
import { signalKeys } from "../../lib/server/signal/store.ts";

function namedVmFixture(parentKey = "names-parent", id = "100", type = "qemu") {
  const parent = { ...host(parentKey), role: "hypervisor" };
  const vm = { vmKey: opaqueReference("vm", parentKey, type + "/" + id), vmId: id, name: "technical-vm", parentHostKey: parentKey, linuxHostKey: null, state: "stopped", metrics: { cpuUsagePercent: metric(12) }, evidence: evidence() };
  parent.vms = [vm]; return { parent, vm };
}

test("VM names persist with atomic revisions, immutable identities, no Agent and no presentation revision writes", async () => {
  const { parent, vm } = namedVmFixture(), other = namedVmFixture("names-other"), lxc = namedVmFixture("names-parent", "100", "lxc");
  parent.vms.push(lxc.vm);
  await publish({ [keys.hosts]: [parent, other.parent], [keys.host(parent.hostKey)]: parent });
  const before = (await getPresentation()).data.revision, input = { expectedRevision: 0, displayName: "tpl Friendly" };
  const writes = await Promise.all([1, 2].map(() => handlers.vmConfigPut(request("/", "PUT", input), params({ vmKey: vm.vmKey }))));
  assert.deepEqual(writes.map(response => response.status).sort(), [200, 409]);
  const saved = (await writes.find(response => response.status === 200).json()).data;
  assert.equal(saved.originalName, vm.name); assert.equal(saved.virtualizationType, "qemu"); assert.equal(saved.revision, 1);
  await saveVmConfig(other.vm.vmKey, { ...input, displayName: "Other parent" });
  await saveVmConfig(lxc.vm.vmKey, { ...input, displayName: "Other type" });
  const hosts = (await (await handlers.hostsGet(request())).json()).data;
  assert.deepEqual(hosts[0].vms.map(vm => vm.displayName), ["tpl Friendly", "Other type"]);
  assert.equal(hosts[0].vms[0].name, vm.name); assert.equal(hosts[0].vms[0].metrics.cpuUsagePercent.value, 12);
  assert.equal(hosts[1].vms[0].displayName, "Other parent");
  const raw = JSON.parse(await cache.get(keys.hosts)); assert.equal(JSON.stringify(raw).includes("tpl Friendly"), false);
  assert.equal((await getPresentation()).data.revision, before);
  await getPrisma().$disconnect(); delete globalThis.pulsePrisma;
  assert.equal((await listVmConfigs()).find(item => item.vmKey === vm.vmKey).displayName, input.displayName);
  await clearSnapshots();
  assert.equal((await saveVmConfig(vm.vmKey, { expectedRevision: 1, displayName: null })).revision, 2);
  assert.equal((await (await handlers.vmConfigsGet(request())).json()).data.some(item => item.vmKey === vm.vmKey), true);
  vm.name = "renamed-at-source"; await publish({ [keys.hosts]: [parent] });
  assert.equal((await (await handlers.hostsGet(request())).json()).data[0].vms[0].displayName, "renamed-at-source");
  assert.equal((await handlers.vmConfigPut(request("/", "PUT", input), params({ vmKey: vm.vmKey }))).status, 409);
});

test("VM name creation rejects templates, forged identity, stale discovery and unknown body fields", async () => {
  const { parent, vm } = namedVmFixture("names-validation");
  const input = { expectedRevision: 0, displayName: "VM" };
  const put = body => handlers.vmConfigPut(request("/", "PUT", body), params({ vmKey: vm.vmKey }));
  vm.name = "tpl-template"; await publish({ [keys.hosts]: [parent] });
  assert.equal((await put(input)).status, 404);
  vm.name = "vm-normal"; vm.vmKey = opaqueReference("vm", "forged-parent", "qemu/100");
  await publish({ [keys.hosts]: [parent] }); assert.equal((await put(input)).status, 409);
  vm.vmKey = opaqueReference("vm", parent.hostKey, "qemu/100");
  await publish({ [keys.hosts]: [parent] });
  assert.equal((await put({ ...input, hostKey: "forged" })).status, 400);
  await markSyncFailure(); assert.equal((await put(input)).status, 409);
  await publish({ [keys.hosts]: [parent] });
  vm.metrics.cpuUsagePercent.observedAt = "2000-01-01T00:00:00.000Z";
  vm.metrics.cpuUsagePercent.quality = "stale";
  await publish({ [keys.hosts]: [parent] }); assert.equal((await put(input)).status, 200);
});

test("VM preferences unavailable preserve Redis telemetry and return safe errors for admin writes", async () => {
  const { parent, vm } = namedVmFixture("names-db-failure");
  await publish({ [keys.hosts]: [parent], [keys.host(parent.hostKey)]: parent });
  await getDatabase().query("ALTER TABLE vm_display_config RENAME TO vm_display_config_test_hidden");
  try {
    for (const response of [await handlers.hostsGet(request()), await handlers.hostGet(request(), params({ hostKey: parent.hostKey }))]) {
      assert.equal(response.status, 200);
      const body = await response.json(), host = Array.isArray(body.data) ? body.data[0] : body.data;
      assert.equal(body.presentationStatus, "unavailable"); assert.equal(body.stale, false);
      assert.equal(host.vms[0].name, vm.name); assert.equal(host.vms[0].metrics.cpuUsagePercent.quality, "fresh");
    }
    const response = await result(await handlers.vmConfigPut(request("/", "PUT", { expectedRevision: 0, displayName: "name" }), params({ vmKey: vm.vmKey })));
    assert.equal(response.status, 503); assert.deepEqual(response.body, { error: { code: "database_unavailable" } });
    assert.equal((await handlers.vmConfigsGet(request())).status, 503);
  } finally { await getDatabase().query("ALTER TABLE vm_display_config_test_hidden RENAME TO vm_display_config"); }
});

test("contextual container writes verify the current VM Agent and target and aliases survive without highlight", async () => {
  const { parent, vm } = namedVmFixture("names-workloads"), agent = { ...host("names-agent"), role: "linux" }, other = { ...host("names-another-agent"), role: "linux" };
  vm.linuxHostKey = agent.hostKey;
  const target = container("same-service", agent.hostKey), duplicate = container("same-service", other.hostKey);
  const entries = { [keys.hosts]: [parent, agent, other], [keys.containers(agent.hostKey)]: [target], [keys.containers(other.hostKey)]: [duplicate] };
  await publish(entries);
  const context = { parentHostKey: parent.hostKey, vmKey: vm.vmKey, containerReference: target.reference };
  const body = { resourceType: "docker_container", zabbixHostKey: agent.hostKey, selectorType: "exact_name", selectorValue: target.name, displayName: "Friendly app", enabled: true, dashboardEnabled: false, context };
  const saved = await result(await handlers.servicePost(request("/", "POST", body)));
  assert.equal(saved.status, 201); const id = saved.body.data.id;
  const list = (await (await handlers.containersGet(request())).json()).data;
  assert.equal(list.find(item => item.reference === target.reference).displayName, "Friendly app");
  assert.equal(list.find(item => item.reference === duplicate.reference).displayName, duplicate.name);
  const workloads = (await (await handlers.vmContainersGet(request(), params({ hostKey: parent.hostKey, vmKey: vm.vmKey }))).json()).data;
  assert.equal(workloads.containers[0].displayName, "Friendly app");
  assert.equal((await handlers.servicePatch(request("/", "PATCH", { dashboardEnabled: true, context, expectedRevision: (await getResource(id)).revision }), params({ id }))).status, 200);
  vm.linuxHostKey = other.hostKey; await publish(entries);
  assert.equal((await handlers.servicePatch(request("/", "PATCH", { expectedRevision: (await getResource(id)).revision, displayName: "Wrong", context }), params({ id }))).status, 409);
  assert.equal((await getResource(id)).displayName, "Friendly app");
  vm.linuxHostKey = agent.hostKey; await publish(entries);
  assert.equal((await handlers.servicePost(request("/", "POST", { ...body, context: { ...context, containerReference: duplicate.reference } }))).status, 409);
  entries[keys.containers(agent.hostKey)] = []; await publish(entries);
  assert.equal((await handlers.servicePatch(request("/", "PATCH", { expectedRevision: (await getResource(id)).revision, displayName: "Missing", context }), params({ id }))).status, 409);
  assert.equal((await handlers.servicePatch(request("/", "PATCH", { expectedRevision: (await getResource(id)).revision, displayName: "Offline preference" }), params({ id }))).status, 200);
});

let admin, cache, token, databaseCreated = false, leaseOwned = false;
const databaseName = "pulse_phase03_test_" + process.pid + "_" + Date.now();
const leaseKey = "pulse:test:phase03:lease", lease = randomUUID();
const touchedKeys = new Set();
const originalEnv = { DATABASE_URL: process.env.DATABASE_URL, REDIS_URL: process.env.REDIS_URL, TOKEN_ENCRYPTION_KEY: process.env.TOKEN_ENCRYPTION_KEY, PULSE_EDITOR_EMAILS: process.env.PULSE_EDITOR_EMAILS };
const originalFetch = globalThis.fetch;
const hostConfig = { resourceType: "host", zabbixHostKey: "asgard", dashboardEnabled: true };
const editorEmail = "editor@pulse.test";
const user = { id: 42, email: editorEmail, administrador: false, permissoes: [] };
const publicTables = ["_prisma_migrations", "external_service", "external_service_sample", "monitored_resource_config", "notification_change", "notification_event", "notification_incident", "notification_stream_state", "notification_target_state", "notification_webhook", "notification_webhook_delivery", "pulse_settings", "signal_infra_link", "signal_monitor_sample", "signal_service", "signal_target", "standalone_vps", "storage_config", "vm_display_config", "vm_template_config", "vps_monitor_sample", "vps_stack"];
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

test("three metric migration upgrades existing choices and defaults without changing other configuration", async () => {
  const client = await getDatabase().connect();
  try {
    await client.query("BEGIN");
    await client.query(`CREATE TEMP TABLE monitored_resource_config(id int, resource_type text, presentation jsonb CONSTRAINT resource_presentation_check CHECK(presentation->'cardMetrics' IN ('["cpu","memory"]','["cpu","disk"]','["disk","memory"]'))) ON COMMIT DROP;
      CREATE TEMP TABLE signal_service(id int, card_metrics jsonb CONSTRAINT signal_service_card_metrics_check CHECK(card_metrics IN ('["cpu","memory"]','["cpu","disk"]','["disk","memory"]'))) ON COMMIT DROP;
      CREATE TEMP TABLE storage_config(id int, filesystem_keys jsonb, disk_warning_percent int, critical boolean) ON COMMIT DROP;
      CREATE TEMP TABLE standalone_vps(id int, monitor_paused boolean, critical boolean) ON COMMIT DROP;
      INSERT INTO monitored_resource_config VALUES(1,'host','{"cardMetrics":["cpu","disk"],"showCpu":true,"showMemory":false,"showDisk":true,"metricsSource":"agent"}');
      INSERT INTO signal_service VALUES(1,'["disk","memory"]');
      INSERT INTO storage_config VALUES(1,'["root"]',70,true);
      INSERT INTO standalone_vps VALUES(1,true,true);`);
    const sql = await readFile(new URL("../../prisma/migrations/20261103190000_minicard_three_metrics/migration.sql", import.meta.url), "utf8");
    await client.query(sql);
    assert.deepEqual((await client.query("SELECT presentation->'cardMetrics' AS metrics FROM monitored_resource_config")).rows[0].metrics, ["cpu", "disk"]);
    assert.deepEqual((await client.query("SELECT card_metrics FROM signal_service")).rows[0].card_metrics, ["disk", "memory"]);
    assert.deepEqual((await client.query("SELECT * FROM storage_config")).rows[0], { id: 1, filesystem_keys: ["root"], disk_warning_percent: 70, critical: true, card_metrics: ["cpu", "disk"] });
    assert.deepEqual((await client.query("SELECT * FROM standalone_vps")).rows[0], { id: 1, monitor_paused: true, critical: true, card_metrics: null });
    for (const metrics of [["cpu", "memory"], ["cpu", "disk"], ["disk", "memory"], ["cpu", "memory", "disk"]]) {
      for (const table of ["signal_service", "storage_config", "standalone_vps"]) await client.query(`UPDATE ${table} SET card_metrics=$1`, [JSON.stringify(metrics)]);
      await client.query("UPDATE monitored_resource_config SET presentation=jsonb_set(presentation,'{cardMetrics}',$1)", [JSON.stringify(metrics)]);
    }
    for (const metrics of [["disk", "cpu", "memory"], ["cpu", "disk", "disk"], null, ["cpu"]]) for (const table of ["signal_service", "storage_config", "standalone_vps", "monitored_resource_config"]) {
      await client.query("SAVEPOINT invalid_choice");
      await assert.rejects(client.query(table === "monitored_resource_config" ? "UPDATE monitored_resource_config SET presentation=jsonb_set(presentation,'{cardMetrics}',$1)" : `UPDATE ${table} SET card_metrics=$1`, [JSON.stringify(metrics)]), error => error.code === "23514");
      await client.query("ROLLBACK TO SAVEPOINT invalid_choice");
    }
  } finally { await client.query("ROLLBACK"); client.release(); }
});

test("resource, Agent and VPS persist the explicit trio and legacy omitted writes preserve it", async () => {
  const h = host("trio-resource"); await publish({ [keys.hosts]: [h] });
  const trio = ["cpu", "memory", "disk"];
  const created = await createResource({ ...hostConfig, zabbixHostKey: h.hostKey, presentation: { cardMetrics: trio } });
  assert.deepEqual((await getResource(created.id)).presentation.cardMetrics, trio);
  const changed = await updateResource(created.id, { expectedRevision: created.revision, description: "Presentation retained" });
  assert.deepEqual(changed.presentation.cardMetrics, trio);
  await assert.rejects(updateResource(created.id, { expectedRevision: created.revision, presentation: { cardMetrics: ["disk", "memory"] } }), error => error.status === 409);
  await deleteResource(created.id);
  const response = await result(await handlers.standaloneVpsPost(request("/", "POST", { ...vpsInput({ name: "Trio VPS", ip: "10.88.0.3" }), cardMetrics: trio })));
  assert.equal(response.status, 201); const id = response.body.data.id;
  assert.deepEqual(response.body.data.cardMetrics, trio);
  const preserved = await result(await handlers.standaloneVpsPatch(request("/", "PATCH", { expectedRevision: 1, provider: "Updated" }), params({ id })));
  assert.equal(preserved.status, 200); assert.deepEqual(preserved.body.data.cardMetrics, trio);
  assert.deepEqual((await getPrisma().standaloneVps.findUniqueOrThrow({ where: { id } })).cardMetrics, trio);
  assert.equal((await handlers.standaloneVpsPatch(request("/", "PATCH", { expectedRevision: 1, cardMetrics: null }), params({ id }))).status, 409);
  const strip = await result(await handlers.standaloneVpsPatch(request("/", "PATCH", { expectedRevision: 2, cardMetrics: null }), params({ id })));
  assert.equal(strip.status, 200); assert.equal(strip.body.data.cardMetrics, null);
  assert.equal((await getPrisma().standaloneVps.findUniqueOrThrow({ where: { id } })).cardMetrics, null);
  await handlers.standaloneVpsDelete(request("/", "DELETE"), params({ id }));
});

test("Signal service trio survives omitted PATCH and revision conflicts through its real BFF", async () => {
  const trio = ["cpu", "memory", "disk"];
  const target = await getPrisma().signalTarget.create({ data: { displayName: "Three metrics target", baseUrl: "https://three-metrics.example" } });
  try {
    const created = await result(await handlers.signalServicePost(request("/", "POST", { expectedTargetRevision: 1, displayName: "Database", servicePrefix: "trio_stack_postgres", cardMetrics: trio }), params({ id: target.id })));
    assert.equal(created.status, 201);
    const service = created.body.data.services[0]; assert.deepEqual(service.cardMetrics, trio);
    assert.deepEqual((await getPrisma().signalService.findUniqueOrThrow({ where: { id: service.id } })).cardMetrics, trio);
    const changed = await result(await handlers.signalServicePatch(request("/", "PATCH", { expectedTargetRevision: 2, expectedRevision: 1, displayName: "Friendly database" }), params({ id: target.id, serviceId: service.id })));
    assert.equal(changed.status, 200); assert.deepEqual(changed.body.data.services[0].cardMetrics, trio);
    assert.equal((await handlers.signalServicePatch(request("/", "PATCH", { expectedTargetRevision: 2, expectedRevision: 1, cardMetrics: ["cpu", "disk"] }), params({ id: target.id, serviceId: service.id }))).status, 409);
    const read = await result(await handlers.signalServiceGet(request(), params({ id: target.id, serviceId: service.id })));
    assert.equal(read.status, 200); assert.deepEqual(read.body.data.cardMetrics, trio);
  } finally { await getPrisma().signalTarget.delete({ where: { id: target.id } }); }
});

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
  process.env.PULSE_EDITOR_EMAILS = editorEmail;
  token = sealEnvelope({ type: "access", token: "test-only", user, sessionId: randomUUID(), expiresAt: Date.now() + 600000 });
  globalThis.fetch = () => { throw new Error("Monitoring must not call any upstream in this phase"); };
  await getPrisma().pulseSetting.upsert({ where: { key: "dashboardPresentation" }, update: { value: initialPresentation(randomUUID) }, create: { key: "dashboardPresentation", value: initialPresentation(randomUUID) } });
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
  await publish({ [keys.hosts]: [host()] });
  const a = await createResource({ ...hostConfig, description: " Portal de atendimento ", serviceType: " Front " });
  assert.equal((await getResource(a.id)).description, "Portal de atendimento");
  assert.equal((await getResource(a.id)).serviceType, "Front");
  await updateResource(a.id, { displayName: "Portal" });
  assert.equal((await getResource(a.id)).description, "Portal de atendimento");
  await updateResource(a.id, { description: null, serviceType: " " });
  assert.equal((await getResource(a.id)).description, null);
  assert.equal((await getResource(a.id)).serviceType, null);
  await assert.rejects(createResource(hostConfig), error => error.status === 409);
  const { rows } = await getDatabase().query("SELECT table_name FROM information_schema.tables WHERE table_schema='public' ORDER BY table_name");
  assert.deepEqual(rows.map(row => row.table_name), publicTables);
  const invalid = [
    [randomUUID(), "host", "zabbix", "other", "exact_name", "x", {}],
    [randomUUID(), "docker_container", "zabbix", "other", null, null, {}],
    [randomUUID(), "host", "other", "other", null, null, {}],
    [randomUUID(), "host", "zabbix", "other", null, null, { cpu: 55 }],
    [randomUUID(), "host", "zabbix", "other", null, null, { showHealth: true }],
    [randomUUID(), "host", "zabbix", "other", null, null, { showCpu: null }],
  ];
  for (const values of invalid) await assert.rejects(getDatabase().query('INSERT INTO monitored_resource_config(id,resource_type,source,zabbix_host_key,selector_type,selector_value,presentation) VALUES($1,$2,$3,$4,$5,$6,$7)', values), error => error.code === "23514");
  await publish({ [keys.hosts]: [host(), host("concurrent")] });
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

test("custom slot compositions persist independently per screen and reject stale or broken assignments", async () => {
  const previous = (await getPresentation()).data;
  const previousHosts = process.env.PULSE_PUBLIC_HOSTS, previousDemo = process.env.PULSE_DEMO_MODE;
  try {
    const { revision: ignored, ...settings } = initialV2(randomUUID); void ignored;
    settings.screens.push(initialV2(randomUUID).screens[0]);
    settings.screens.forEach((screen, index) => {
      screen.overviewGrid = "split_custom";
      const signal = { id: randomUUID(), type: "signal_flow", enabled: true, width: "wide", options: effectiveOptions({ type: "signal_flow" }) };
      screen.blocks.push(signal);
      const find = type => screen.blocks.find(block => block.type === type).id;
      screen.overviewSlots = { topLeft: [find("highlighted_resources")], topRight: index ? [find("problems")] : [signal.id, find("problems")], bottomLeft: [find("asgard_summary")], bottomRight: index ? [signal.id] : [] };
    });
    const saved = await savePresentation({ expectedRevision: previous.revision, settings });
    assert.deepEqual((await getPresentation()).data.screens.map(screen => screen.overviewSlots), settings.screens.map(screen => screen.overviewSlots));
    const read = await result(await handlers.presentationGet(request()));
    assert.equal(read.status, 200); assert.deepEqual(read.body.data.screens[1].overviewSlots, settings.screens[1].overviewSlots);
    process.env.PULSE_PUBLIC_HOSTS = "public.example.test"; process.env.PULSE_DEMO_MODE = "0";
    const publicRead = await publicGet(new Request("http://public.example.test/api/public/settings/presentation", { headers: { Host: "public.example.test" } }), ["settings", "presentation"]);
    assert.equal(publicRead.status, 200);
    assert.deepEqual((await publicRead.json()).data.screens.map(screen => screen.overviewSlots), settings.screens.map(screen => screen.overviewSlots));
    await assert.rejects(savePresentation({ expectedRevision: previous.revision, settings }), error => error.code === "revision_conflict");
    const invalid = structuredClone(settings); invalid.screens[0].overviewSlots.bottomRight = [settings.screens[1].blocks[1].id];
    await assert.rejects(savePresentation({ expectedRevision: saved.data.revision, settings: invalid }), error => error.name === "ZodError");
    assert.equal((await getPresentation()).data.revision, saved.data.revision);
  } finally {
    if (previousHosts === undefined) delete process.env.PULSE_PUBLIC_HOSTS; else process.env.PULSE_PUBLIC_HOSTS = previousHosts;
    if (previousDemo === undefined) delete process.env.PULSE_DEMO_MODE; else process.env.PULSE_DEMO_MODE = previousDemo;
    const { revision: ignored, ...settings } = previous; void ignored;
    await savePresentation({ expectedRevision: (await getPresentation()).data.revision, settings });
  }
});
test("CRUD HTTP contracts preserve untouched fields, reject unknown writes and keep UUID ordering", async () => {
  await publish({ [keys.hosts]: [host()], [keys.containers("asgard")]: [container()] });
  const post = await result(await handlers.servicePost(request("/monitoring/services", "POST", { resourceType: "docker_container", zabbixHostKey: "asgard", selectorType: "name_prefix", selectorValue: "evolution", displayOrder: 4, dashboardEnabled: true })));
  assert.equal(post.status, 201);
  const id = post.body.data.id;
  const patched = await result(await handlers.servicePatch(request("/", "PATCH", { expectedRevision: (await getResource(id)).revision, displayName: "Evolution" }), params({ id })));
  assert.equal(patched.status, 200); assert.equal(patched.body.data.displayOrder, 4); assert.equal(patched.body.data.dashboardEnabled, true);
  assert.equal((await handlers.servicePatch(request("/", "PATCH", { cpu: 0 }), params({ id }))).status, 400);
  assert.equal((await handlers.servicePatch(request("/", "PATCH", { selectorType: "regex", selectorValue: "[" }), params({ id }))).status, 400);
  assert.equal((await handlers.serviceGet(request(), params({ id: "not-uuid" }))).status, 400);
  assert.equal((await handlers.serviceDelete(request("/", "DELETE", { expectedRevision: 1 }), params({ id: randomUUID() }))).status, 404);
  assert.equal((await handlers.servicePost(request("/", "POST", { ...hostConfig, displayOrder: -1 }))).status, 400);
  const configs = await listResources();
  assert.deepEqual(configs.map(item => item.id), [...configs].sort((a,b) => a.displayOrder - b.displayOrder || a.id.localeCompare(b.id)).map(item => item.id));
  assert.equal((await handlers.serviceDelete(request("/", "DELETE", { expectedRevision: (await getResource(id)).revision }), params({ id }))).status, 204);
});
test("presentation validates references and DELETE repairs every affected screen in one transaction", async () => {
  await publish({ [keys.hosts]: [host("presentation-target")] });
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
  await publish({ [keys.hosts]: [host("race-target")] });
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
    assert.equal(response.status, 200); assert.deepEqual(response.body, { data: [], availability: "no_data", stale: false, lastUpdated: null, refreshAfterMs: 20000, presentationStatus: "ready", ...(handler === handlers.hostsGet ? { asgardHostKey: null } : {}) });
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
test("sync failure keeps snapshots readable when Redis Lua round-trips empty extension arrays", async () => {
  const publishedAt = at();
  const generation = await publish({ [keys.hosts]: [host()] }, publishedAt);
  const originalSnapshot = await cache.get(keys.hosts), ttl = await cache.ttl(keys.sync);
  await markSyncFailure("zabbix_unavailable");
  await markSyncFailure("collection_failed");
  const batch = await readSnapshotBatch([keys.hosts]);
  assert.equal(batch.generation, generation);
  assert.equal(batch.sync.status, "failed");
  assert.equal(batch.sync.lastSuccessfulAt, publishedAt);
  assert.deepEqual(batch.sync.keys, [keys.hosts]);
  assert.deepEqual(batch.sync.extensionKeys, []);
  assert.equal(readResult(null, batch, [keys.hosts]).stale, true);
  assert.equal(await cache.get(keys.hosts), originalSnapshot);
  assert.ok(await cache.ttl(keys.sync) <= ttl);
  assert.ok(await cache.ttl(keys.sync) >= ttl - 2);
  const response = await handlers.hostsGet(request());
  assert.equal(response.status, 200);
  assert.equal((await response.json()).stale, true);
});

test("sync failure preserves nonempty Storage extensions and accepts legacy generations", async () => {
  await publish({ [keys.hosts]: [host()], [keys.storages]: { fixture: true } });
  await markSyncFailure();
  let batch = await readSnapshotBatch([keys.hosts, keys.storages]);
  assert.deepEqual(batch.sync.keys, [keys.hosts, keys.storages]);
  assert.deepEqual(batch.sync.extensionKeys, [keys.storages]);
  assert.equal(batch.snapshots.get(keys.storages).generation, batch.generation);
  await publish({ [keys.hosts]: [host()] });
  const legacy = JSON.parse(await cache.get(keys.sync));
  delete legacy.data.extensionKeys;
  await cache.set(keys.sync, JSON.stringify(legacy), { KEEPTTL: true });
  await markSyncFailure();
  batch = await readSnapshotBatch([keys.hosts]);
  assert.deepEqual(batch.sync.keys, [keys.hosts]);
  assert.equal(batch.sync.extensionKeys, undefined);
  assert.equal(batch.sync.status, "failed");
});

test("empty sync generations survive repeated failures without accepting malformed key lists", async () => {
  await publish({});
  await markSyncFailure();
  await markSyncFailure();
  const batch = await readSnapshotBatch([keys.hosts]);
  assert.deepEqual(batch.sync.keys, []);
  assert.deepEqual(batch.sync.extensionKeys, []);
  assert.equal(batch.snapshots.get(keys.hosts), null);
  assert.equal(readResult(null, batch, [keys.hosts]).stale, true);
  const sync = JSON.parse(await cache.get(keys.sync));
  for (const field of ["keys", "extensionKeys"]) for (const invalid of [{ forged: true }, null, "not-an-array", [42]]) {
    await cache.set(keys.sync, JSON.stringify({ ...sync, data: { ...sync.data, keys: [], extensionKeys: [], [field]: invalid } }), { KEEPTTL: true });
    await assert.rejects(readSnapshotBatch([keys.hosts]), error => error.code === "cache_unavailable");
  }
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
  await publish({ [keys.hosts]: [host("first"), host("second")], [keys.containers("first")]: [container("task", "first")], [keys.containers("second")]: [container("task", "second")] });
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
test("container inventory joins the selected overview without changing saved screens or requesting history", async () => {
  const { revision, ...settings } = (await getPresentation()).data;
  settings.rotation.autoStart = false;
  settings.screens[0].blocks = [{ id: randomUUID(), type: "container_inventory", enabled: true, width: "full" }];
  await savePresentation({ expectedRevision: revision, settings });
  const first = container("same-service", "agent-a"), second = container("same-service", "agent-b");
  await publish({ [keys.hosts]: [host("agent-a"), host("agent-b")], [keys.containers("agent-a")]: [first], [keys.containers("agent-b")]: [second] });
  const overview = await (await handlers.overviewGet(request())).json();
  assert.equal(overview.data.blocks[0].availability, "ready"); assert.deepEqual(overview.data.blocks[0].data.map(item => item.hostKey), ["agent-a", "agent-b"]);
  assert.deepEqual((await getPresentation()).data.screens, settings.screens);
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

test("host inventory is configurable, excludes templates and exposes the effective hypervisor without changing raw capacity", async () => {
  const fixture = templateFixture(); fixture.target.role = "hypervisor";
  const other = { ...host("secondary"), role: "hypervisor" };
  fixture.entries[keys.hosts].push(other);
  await publish(fixture.entries);
  const hosts = await (await handlers.hostsGet(request())).json();
  assert.equal(hosts.asgardHostKey, "asgard"); assert.equal(hosts.data.length, 2);
  const current = (await getPresentation()).data;
  const settings = initialPresentation(randomUUID); delete settings.revision;
  settings.screens[0].blocks = [{id:randomUUID(),type:"host_inventory",enabled:true,width:"wide"}];
  await savePresentation({expectedRevision:current.revision,settings});
  const response = await (await handlers.overviewGet(request())).json();
  const block = response.data.blocks[0];
  assert.equal(block.availability,"ready"); assert.equal(block.type,"host_inventory"); assert.equal(block.data.length,2);
  assert.deepEqual(block.data[0].vms.map(vm => vm.vmId),["101"]);
  assert.equal(block.data[0].metrics.memoryTotalBytes.value,32768);
  await publish({[keys.hosts]:[other]});
  assert.equal((await (await handlers.hostsGet(request())).json()).asgardHostKey,null);
});
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
  fixture.template.metrics.provisionedCpuCount = { ...fixture.template.metrics.memoryTotalBytes, value: 8, unit: "count" };
  await publish(fixture.entries);
  const withCapacity = await (await handlers.templatesGet(request("/?hostKey=asgard"))).json();
  assert.equal(withCapacity.data[0].virtualCpuCount.value, 8);
  assert.equal(withCapacity.data[0].virtualCpuCount.unit, "count");
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

test("VM workloads validate parent and linked host, preserve configurations and distinguish discovery absence", async () => {
  const parent = { ...host("workload-parent"), role: "hypervisor" };
  const a = { ...host("workload-a"), role: "linux" }, b = { ...host("workload-b"), role: "linux" };
  const vm = { vmKey: "vm-workloads", vmId: "10", parentHostKey: parent.hostKey, name: "Same VM", linuxHostKey: a.hostKey, state: "running", metrics: {}, evidence: evidence() };
  parent.vms = [vm, { ...vm, vmKey: "template", name: "tpl-workload" }];
  const first = container("shared-service", a.hostKey), second = container("shared-service", b.hostKey);
  const entries = { [keys.hosts]: [parent, a, b], [keys.containers(a.hostKey)]: [first], [keys.containers(b.hostKey)]: [second] };
  await publish(entries);
  const config = await createResource({ resourceType: "docker_container", zabbixHostKey: a.hostKey, selectorType: "exact_name", selectorValue: first.name, enabled: false });
  await createResource({ resourceType: "docker_container", zabbixHostKey: b.hostKey, selectorType: "exact_name", selectorValue: second.name });
  entries[keys.containers(a.hostKey)].push(container("missing-service", a.hostKey)); await publish(entries);
  await createResource({ resourceType: "docker_container", zabbixHostKey: a.hostKey, selectorType: "exact_name", selectorValue: "missing-service", critical: true });
  entries[keys.containers(a.hostKey)].pop(); await publish(entries);
  const read = (query = "", values = { hostKey: parent.hostKey, vmKey: vm.vmKey }) => handlers.vmContainersGet(request("/" + query), params(values));
  let response = await read(); assert.equal(response.headers.get("cache-control"), "no-store");
  let body = await response.json();
  assert.equal(body.data.association, "linked"); assert.equal(body.availability, "ready");
  assert.deepEqual(body.data.containers.map(item => item.reference), [first.reference]);
  assert.equal(body.data.configuredServices.length, 2); assert.ok(body.data.configuredServices.every(item => item.config.zabbixHostKey === a.hostKey));
  assert.equal(body.data.configuredServices.find(item => item.id === config.id).config.enabled, false);
  assert.equal(body.data.configuredServices.find(item => item.config.selectorValue === "missing-service").resolution, "missing");
  assert.equal((await read("?linuxHostKey=" + b.hostKey)).status, 400);
  assert.equal((await read("?range=1h")).status, 400);
  assert.equal((await read("", { hostKey: "../bad", vmKey: vm.vmKey })).status, 400);
  assert.equal((await read("", { hostKey: a.hostKey, vmKey: vm.vmKey })).status, 404);
  assert.deepEqual(await (await read("", { hostKey: parent.hostKey, vmKey: "template" })).json(), { error: { code: "vm_not_found" } });
  assert.equal((await read("", { hostKey: parent.hostKey, vmKey: "wrong" })).status, 404);
  vm.linuxHostKey = null; await publish(entries); body = await (await read()).json();
  assert.equal(body.data.association, "unlinked"); assert.equal(body.availability, "unavailable"); assert.deepEqual(body.data.containers, []);
  vm.linuxHostKey = "absent-host"; await publish(entries); body = await (await read()).json(); assert.equal(body.data.association, "host_unavailable");
  vm.linuxHostKey = a.hostKey; a.availability = "unreachable"; await publish(entries); body = await (await read()).json(); assert.equal(body.data.association, "host_unavailable");
  a.availability = "reachable"; delete entries[keys.containers(a.hostKey)]; await publish(entries); body = await (await read()).json();
  assert.equal(body.availability, "no_data"); assert.equal(body.data.association, "linked"); assert.equal(body.data.configuredServices.length, 2);
  entries[keys.containers(a.hostKey)] = []; await publish(entries); body = await (await read()).json(); assert.equal(body.availability, "ready"); assert.deepEqual(body.data.containers, []);
  entries[keys.containers(a.hostKey)] = [first]; await publish(entries); await markSyncFailure(); body = await (await read()).json();
  assert.equal(body.stale, true); assert.equal(body.data.containers.length, 1); assert.equal(body.data.containers[0].status, "unknown");
  entries[keys.containers(a.hostKey)] = [second]; await publish(entries);
  assert.deepEqual(await (await read()).json(), { error: { code: "snapshot_invalid" } });
});

test("VM workload generation changes retry the association and never combine inventories", async () => {
  const a = { ...host("race-agent-a"), role: "linux" }, b = { ...host("race-agent-b"), role: "linux" };
  const vm = { vmKey: "race-vm", vmId: "11", parentHostKey: "race-parent", name: "Same VM", linuxHostKey: a.hostKey, state: "running", metrics: {}, evidence: evidence() };
  const parent = { ...host("race-parent"), role: "hypervisor", vms: [vm] };
  const entries = { [keys.hosts]: [parent, a, b], [keys.containers(a.hostKey)]: [container("same", a.hostKey)], [keys.containers(b.hostKey)]: [container("same", b.hostKey)] };
  await publish(entries);
  const read = () => handlers.vmContainersGet(request(), params({ hostKey: parent.hostKey, vmKey: vm.vmKey }));
  await read();
  const client = globalThis.pulseCache, original = client.mGet;
  const requested = [];
  let swapped = false;
  client.mGet = async function(batchKeys) {
    requested.push(...batchKeys);
    if (!swapped && batchKeys.includes(keys.containers(a.hostKey))) { swapped = true; vm.linuxHostKey = b.hostKey; await publish(entries); }
    return original.call(this, batchKeys);
  };
  try {
    const response = await read(), body = await response.json(); assert.equal(response.status, 200);
    assert.equal(body.data.vm.linuxHostKey, b.hostKey); assert.ok(body.data.containers.every(item => item.hostKey === b.hostKey));
    assert.ok(!requested.includes(keys.containers(parent.hostKey)));
  } finally { client.mGet = original; }
  const raw = JSON.parse(await cache.get(keys.containers(b.hostKey))); raw.generation = randomUUID();
  await cache.set(keys.containers(b.hostKey), JSON.stringify(raw));
  const inconsistent = await read(); assert.equal(inconsistent.status, 503); assert.deepEqual(await inconsistent.json(), { error: { code: "snapshot_inconsistent" } });
  await publish(entries);
  const findMany = getPrisma().monitoredResourceConfig.findMany;
  getPrisma().monitoredResourceConfig.findMany = async () => { throw new Error("test database failure"); };
  try { const response = await read(); assert.equal(response.status, 503); assert.deepEqual(await response.json(), { error: { code: "database_unavailable" } }); }
  finally { getPrisma().monitoredResourceConfig.findMany = findMany; }
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

test("signal_flow layout migration replaces problems on screen 1 and keeps existing signal_flow intact", async () => {
  const sql = await readFile(new URL("../../prisma/migrations/20261009190000_signal_flow_layout/migration.sql", import.meta.url), "utf8");
  const base = initialV2(randomUUID);
  base.revision = 12;
  const problems = base.screens[0].blocks.find(block => block.type === "problems");
  assert.ok(problems);
  const write = value => getDatabase().query("UPDATE pulse_settings SET value=$1::jsonb WHERE key='dashboardPresentation'", [JSON.stringify(value)]);
  await write(base); await getDatabase().query(sql);
  const migrated = (await getPresentation()).data;
  assert.equal(migrated.revision, 13);
  assert.equal(migrated.screens.length, 2);
  assert.equal(migrated.screens[0].blocks.some(block => block.type === "signal_flow"), true);
  assert.equal(migrated.screens[0].blocks.some(block => block.type === "problems"), false);
  assert.equal(migrated.screens[1].blocks.some(block => block.type === "problems" && block.id === problems.id), true);
  const signal = migrated.screens[0].blocks.find(block => block.type === "signal_flow");
  assert.equal(signal.width, problems.width === "full" ? "full" : "wide");
  assert.deepEqual(signal.options, { visibleRows: 4 });
  await getDatabase().query(sql);
  assert.deepEqual((await getPresentation()).data, migrated);
  const already = structuredClone(migrated);
  already.revision = 20;
  await write(already); await getDatabase().query(sql);
  assert.deepEqual((await getPresentation()).data, already);
});

test("options migration preserves identity and preferences, increments once, and leaves excessive legacy screens intact", async () => {
  const sql = await readFile(new URL("../../prisma/migrations/20261003180000_presentation_options/migration.sql", import.meta.url), "utf8");
  const legacy = initialPresentation(randomUUID); legacy.revision = 40; legacy.rotation.intervalSeconds = 52;
  const write = value => getDatabase().query("UPDATE pulse_settings SET value=$1::jsonb WHERE key='dashboardPresentation'", [JSON.stringify(value)]);
  await write(legacy); await getDatabase().query(sql);
  const current = (await getPresentation()).data;
  assert.equal(current.schemaVersion, 2); assert.equal(current.revision, 41); assert.equal(current.rotation.intervalSeconds, 52);
  assert.deepEqual(current.screens.map(screen => ({ ...screen, blocks: screen.blocks.map(({ options, ...block }) => { void options; return block; }) })), legacy.screens);
  // Frozen migration writes the 2026-10-03 shapes; new presentation defaults resolve in memory.
  for (const block of current.screens[0].blocks) {
    if (block.type === "highlighted_resources") {
      assert.deepEqual(block.options, { sortBy: "configured", sortDirection: "asc", criticalOnly: false, visibleRows: 1 });
      assert.deepEqual(effectiveOptions(block), { cardSize: "compact", sortBy: "configured", sortDirection: "asc", criticalOnly: false, visibleRows: 1, selection: "default", cards: [] });
    } else if (block.type === "summary") {
      assert.deepEqual(block.options, { indicators: ["hosts", "containers_running", "containers_stopped", "problems"] });
      assert.deepEqual(effectiveOptions(block), { ...block.options, fontScalePercent: 100 });
    } else assert.deepEqual(block.options, effectiveOptions({ type: block.type }));
  }
  await getDatabase().query(sql); assert.deepEqual((await getPresentation()).data, current);
  const excessive = structuredClone(legacy); excessive.screens[0].blocks = Array.from({ length: 7 }, () => ({ id: randomUUID(), type: "summary", enabled: true, width: "full" }));
  await write(excessive); await getDatabase().query(sql); assert.deepEqual((await getPresentation()).data, excessive);
  const result = await (await handlers.overviewGet(request())).json(); assert.equal(result.data.blocks.length, 7); assert.deepEqual(result.data.blocks[0].options, effectiveOptions({ type: "summary" }));
  assert.deepEqual((await getPresentation()).data, excessive);
});
test("v2 writes validate scope/options, preserve revisions and repair resource deletion with default options", async () => {
  await publish({ [keys.hosts]: [host("v2-target")] });
  const config = await createResource({ ...hostConfig, zabbixHostKey: "v2-target" });
  await getPrisma().pulseSetting.upsert({ where: { key: "monitoringScope" }, update: { value: { hostKeys: ["v2-target"], vmLinks: [] } }, create: { key: "monitoringScope", value: { hostKeys: ["v2-target"], vmLinks: [] } } });
  const { revision, ...settings } = initialV2(randomUUID); void revision;
  let current = (await getPresentation()).data;
  settings.screens[0].blocks = [{ id: randomUUID(), type: "container_inventory", enabled: true, width: "wide", options: { hostKeys: ["outside"] } }];
  await assert.rejects(savePresentation({ expectedRevision: current.revision, settings }), error => error.code === "invalid_host_reference");
  settings.screens[0].blocks[0].options.hostKeys = ["v2-target"];
  current = (await savePresentation({ expectedRevision: current.revision, settings })).data;
  const response = await handlers.presentationPut(request("/", "PUT", { expectedRevision: current.revision, settings: { ...settings, screens: [{ ...settings.screens[0], blocks: [{ ...settings.screens[0].blocks[0], options: { visibleRows: 100 } }] }] } }));
  assert.equal(response.status, 400); const failure = await response.json(); assert.equal(failure.error.fields[0].path, "settings.screens.0.blocks.0.options.visibleRows");
  settings.screens[0].blocks = [{ id: randomUUID(), type: "resource_card", enabled: true, width: "wide", options: {}, resourceConfigId: config.id }];
  current = (await savePresentation({ expectedRevision: current.revision, settings })).data;
  await deleteResource(config.id); const repaired = (await getPresentation()).data;
  assert.equal(repaired.revision, current.revision + 1); assert.deepEqual(repaired.screens[0].blocks[0].options, effectiveOptions({ type: "summary" }));
});
test("monitor scroll startup defaults without rewriting legacy data and persists both values with revision checks", async () => {
  const legacy = initialV2(randomUUID); delete legacy.publicMonitorAutoScrollOnLoad;
  await getDatabase().query("UPDATE pulse_settings SET value=$1::jsonb WHERE key='dashboardPresentation'", [JSON.stringify(legacy)]);
  const loaded = await (await handlers.presentationGet(request())).json();
  assert.equal(loaded.data.publicMonitorAutoScrollOnLoad, true);
  assert.equal(loaded.data.revision, legacy.revision);
  assert.deepEqual((await getDatabase().query("SELECT value FROM pulse_settings WHERE key='dashboardPresentation'")).rows[0].value, legacy);
  const { revision, ...settings } = loaded.data;
  for (const [index, value] of [false, true].entries()) {
    const saved = await handlers.presentationPut(request("/", "PUT", { expectedRevision: revision + index, settings: { ...settings, publicMonitorAutoScrollOnLoad: value } }));
    assert.equal(saved.status, 200);
    assert.equal((await saved.json()).data.publicMonitorAutoScrollOnLoad, value);
    assert.equal((await getPresentation()).data.publicMonitorAutoScrollOnLoad, value);
    assert.deepEqual((await getPresentation()).data.screens, legacy.screens);
  }
  const conflict = await handlers.presentationPut(request("/", "PUT", { expectedRevision: revision, settings: { ...settings, publicMonitorAutoScrollOnLoad: false } }));
  assert.equal(conflict.status, 409);
  const invalid = await handlers.presentationPut(request("/", "PUT", { expectedRevision: revision + 2, settings: { ...settings, publicMonitorAutoScrollOnLoad: 'false' } }));
  assert.equal(invalid.status, 400);
  assert.equal((await getPresentation()).data.publicMonitorAutoScrollOnLoad, true);
});

test("reading scale defaults without a database rewrite and persists through the revision-protected BFF", async () => {
  const legacy = initialV2(randomUUID); delete legacy.displayScalePercent;
  await getDatabase().query("UPDATE pulse_settings SET value=$1::jsonb WHERE key='dashboardPresentation'", [JSON.stringify(legacy)]);
  const loaded = await (await handlers.presentationGet(request())).json();
  assert.equal(loaded.data.displayScalePercent, 110);
  assert.equal(loaded.data.revision, legacy.revision);
  const stored = await getDatabase().query("SELECT value FROM pulse_settings WHERE key='dashboardPresentation'");
  assert.deepEqual(stored.rows[0].value, legacy);
  const { revision, ...settings } = loaded.data; settings.displayScalePercent = 125;
  const saved = await handlers.presentationPut(request("/", "PUT", { expectedRevision: revision, settings }));
  assert.equal(saved.status, 200);
  assert.equal((await saved.json()).data.displayScalePercent, 125);
  assert.equal((await getPresentation()).data.displayScalePercent, 125);
  assert.deepEqual((await getPresentation()).data.screens, legacy.screens);
  const conflict = await handlers.presentationPut(request("/", "PUT", { expectedRevision: revision, settings: { ...settings, displayScalePercent: 100 } }));
  assert.equal(conflict.status, 409);
  const invalid = await handlers.presentationPut(request("/", "PUT", { expectedRevision: revision + 1, settings: { ...settings, displayScalePercent: 150 } }));
  assert.equal(invalid.status, 400);
  assert.equal((await getPresentation()).data.displayScalePercent, 125);
});

test("three screens keep independent KPI and availability options through persistence and real overviews", async () => {
  const current = (await getPresentation()).data;
  const document = initialV2(randomUUID);
  const baseline = document.screens[0];
  document.dashboardZoomPercent = 80; document.publicMonitorZoomPercent = 70;
  document.screens = [
    { scale: 100, size: "compact", rows: 1 },
    { scale: 150, size: "expanded", rows: 2 },
    { scale: 125, size: "compact", rows: 3 },
  ].map((options, index) => ({
    ...structuredClone(baseline), id: randomUUID(), name: `Independent ${index + 1}`,
    blocks: baseline.blocks.map(block => ({
      ...structuredClone(block), id: randomUUID(),
      options: block.type === "summary" ? { ...block.options, fontScalePercent: options.scale }
        : block.type === "highlighted_resources" ? { ...block.options, cardSize: options.size, visibleRows: options.rows, rowMode: "manual" } : block.options,
    })),
  }));
  const { revision: _revision, ...settings } = document; void _revision;
  const saved = await handlers.presentationPut(request("/", "PUT", { expectedRevision: current.revision, settings }));
  assert.equal(saved.status, 200);
  const confirmed = (await saved.json()).data;
  assert.deepEqual(confirmed.screens, document.screens);
  for (const screen of confirmed.screens) {
    const response = await handlers.overviewGet(request("/?screenId=" + screen.id));
    assert.equal(response.status, 200);
    const overview = (await response.json()).data;
    assert.equal(overview.screenId, screen.id); assert.equal(overview.presentationRevision, confirmed.revision);
    for (const block of screen.blocks) assert.deepEqual(overview.blocks.find(item => item.blockId === block.id).options, effectiveOptions(block));
  }
  // Move screen 3, then change just one of its block options. Neither sibling may change.
  const next = structuredClone(settings), selected = next.screens[2];
  selected.blocks.find(block => block.type === "summary").options.fontScalePercent = 110;
  next.screens = [selected, next.screens[0], next.screens[1]];
  assert.equal((await handlers.presentationPut(request("/", "PUT", { expectedRevision: confirmed.revision, settings: next }))).status, 200);
  const after = (await getPresentation()).data;
  assert.deepEqual(after.screens.slice(1), confirmed.screens.slice(0, 2));
  assert.equal(after.dashboardZoomPercent, 80); assert.equal(after.publicMonitorZoomPercent, 70);
  const selectedOverview = await (await handlers.overviewGet(request("/?screenId=" + selected.id))).json();
  assert.equal(selectedOverview.data.blocks.find(block => block.type === "summary").options.fontScalePercent, 110);
});

test("manual availability rows persist per block and legacy reads do not rewrite automatic preferences", async () => {
  const legacy = initialV2(randomUUID);
  await getDatabase().query("UPDATE pulse_settings SET value=$1::jsonb WHERE key='dashboardPresentation'", [JSON.stringify(legacy)]);
  const loaded = (await getPresentation()).data;
  assert.equal(loaded.screens[0].blocks[1].options.rowMode, undefined);
  assert.deepEqual((await getDatabase().query("SELECT value FROM pulse_settings WHERE key='dashboardPresentation'")).rows[0].value, legacy);
  const { revision, ...settings } = loaded;
  settings.screens[0].blocks[1].options = { ...settings.screens[0].blocks[1].options, rowMode: "manual", visibleRows: 3 };
  const saved = await handlers.presentationPut(request("/", "PUT", { expectedRevision: revision, settings }));
  assert.equal(saved.status, 200);
  const current = (await getPresentation()).data;
  assert.equal(current.screens[0].blocks[1].options.rowMode, "manual"); assert.equal(current.screens[0].blocks[1].options.visibleRows, 3);
  assert.deepEqual(current.screens[0].blocks[0], legacy.screens[0].blocks[0]);
  const invalid = structuredClone(settings); invalid.screens[0].blocks[1].options.rowMode = "fixed";
  assert.equal((await handlers.presentationPut(request("/", "PUT", { expectedRevision: current.revision, settings: invalid }))).status, 400);
  assert.equal((await handlers.presentationPut(request("/", "PUT", { expectedRevision: revision, settings }))).status, 409);
  assert.deepEqual((await getPresentation()).data, current);
});

test("private root zoom defaults without writes and persists independently of public zoom through the BFF", async () => {
  const legacy = initialV2(randomUUID); delete legacy.dashboardZoomPercent; legacy.publicMonitorZoomPercent = 70;
  await getDatabase().query("UPDATE pulse_settings SET value=$1::jsonb WHERE key='dashboardPresentation'", [JSON.stringify(legacy)]);
  const loaded = await (await handlers.presentationGet(request())).json();
  assert.equal(loaded.data.dashboardZoomPercent, 100); assert.equal(loaded.data.publicMonitorZoomPercent, 70);
  assert.deepEqual((await getDatabase().query("SELECT value FROM pulse_settings WHERE key='dashboardPresentation'")).rows[0].value, legacy);
  const { revision, ...settings } = loaded.data;
  const saved = await handlers.presentationPut(request("/", "PUT", { expectedRevision: revision, settings: { ...settings, dashboardZoomPercent: 80 } }));
  assert.equal(saved.status, 200);
  const current = (await getPresentation()).data;
  assert.equal(current.dashboardZoomPercent, 80); assert.equal(current.publicMonitorZoomPercent, 70);
  assert.deepEqual(current.screens, legacy.screens);
  const changedPublic = await handlers.presentationPut(request("/", "PUT", { expectedRevision: current.revision, settings: { ...settings, dashboardZoomPercent: 80, publicMonitorZoomPercent: 60 } }));
  assert.equal(changedPublic.status, 200);
  const latest = (await getPresentation()).data;
  assert.equal(latest.dashboardZoomPercent, 80); assert.equal(latest.publicMonitorZoomPercent, 60);
  const invalid = await handlers.presentationPut(request("/", "PUT", { expectedRevision: latest.revision, settings: { ...settings, dashboardZoomPercent: 151 } }));
  assert.equal(invalid.status, 400);
  const conflict = await handlers.presentationPut(request("/", "PUT", { expectedRevision: revision, settings }));
  assert.equal(conflict.status, 409);
  assert.deepEqual((await getPresentation()).data, latest);
});

test("idle presentation defaults without rewriting legacy data and saves with revision and minute validation", async () => {
  const legacy = initialV2(randomUUID); delete legacy.idlePresentation;
  await getDatabase().query("UPDATE pulse_settings SET value=$1::jsonb WHERE key='dashboardPresentation'", [JSON.stringify(legacy)]);
  const loaded = await (await handlers.presentationGet(request())).json();
  assert.deepEqual(loaded.data.idlePresentation, { enabled: false, afterMinutes: 5, requestFullscreen: true });
  assert.deepEqual((await getDatabase().query("SELECT value FROM pulse_settings WHERE key='dashboardPresentation'")).rows[0].value, legacy);
  const { revision, ...settings } = loaded.data;
  settings.idlePresentation = { enabled: true, afterMinutes: 10, requestFullscreen: false };
  const saved = await handlers.presentationPut(request("/", "PUT", { expectedRevision: revision, settings }));
  assert.equal(saved.status, 200);
  assert.deepEqual((await getPresentation()).data.idlePresentation, settings.idlePresentation);
  assert.deepEqual((await getPresentation()).data.screens, legacy.screens);
  const conflict = await handlers.presentationPut(request("/", "PUT", { expectedRevision: revision, settings }));
  assert.equal(conflict.status, 409);
  for (const minutes of [0, 121, 1.5, "5", null]) {
    const invalid = await handlers.presentationPut(request("/", "PUT", { expectedRevision: revision + 1, settings: { ...settings, idlePresentation: { ...settings.idlePresentation, afterMinutes: minutes } } }));
    assert.equal(invalid.status, 400);
  }
  assert.equal((await getPresentation()).data.revision, revision + 1);
});

test("resource creation needs current discovery, while existing preferences and configuration reads survive missing inventory", async () => {
  await clearSnapshots(); await assert.rejects(createResource({ ...hostConfig, zabbixHostKey: "new-target" }), error => error.code === "resource_inventory_unavailable");
  await publish({ [keys.hosts]: [host("new-target")] });
  const config = await createResource({ ...hostConfig, zabbixHostKey: "new-target" });
  await clearSnapshots(); const updated = await updateResource(config.id, { ...config, id: undefined }).catch(() => null); assert.equal(updated, null);
  const saved = await updateResource(config.id, { displayName: "Offline preference", zabbixHostKey: "new-target", selectorType: null, selectorValue: null, resourceType: "host" });
  assert.equal(saved.displayName, "Offline preference");
  const response = await handlers.resourceConfigsGet(request()); assert.equal(response.status, 200); assert.ok((await response.json()).data.some(item => item.id === config.id));
  await assert.rejects(updateResource(config.id, { zabbixHostKey: "outside" }), error => error.code === "resource_inventory_unavailable");
  await deleteResource(config.id);
});

const appRoot = fileURLToPath(new URL("../..", import.meta.url));
const externalInput = (path = "/health", extra = {}) => ({ displayName: "API externa", method: "GET", url: "https://1.1.1.1" + path, successMode: "http_status", authMode: "none", ...extra });
function runProbeProcess(overrides = {}, unset = []) {
  const env = { ...process.env, ...overrides };
  for (const key of unset) delete env[key];
  return new Promise(resolve => {
    const child = spawn(process.execPath, ["--conditions=react-server", "collector/probe.mjs", "--once"], { cwd: appRoot, env });
    let stdout = "", stderr = "";
    child.stdout.on("data", chunk => { stdout += chunk; });
    child.stderr.on("data", chunk => { stderr += chunk; });
    child.on("close", code => resolve({ code, stdout, stderr }));
  });
}

test("external services keep secrets out of reads and do not affect the Zabbix snapshot", async () => {
  await publish({ [keys.hosts]: [host("probe-host")] });
  const resource = await createResource({ ...hostConfig, zabbixHostKey: "probe-host", dashboardEnabled: true, displayOrder: 2 });
  const before = await result(await handlers.overviewGet(request()));
  const syncBefore = await cache.get(keys.sync);
  const secret = "probe-secret-value";
  const created = await result(await handlers.externalServicePost(request("/", "POST", externalInput("/json", { displayName: "Com segredo", successMode: "json_match", jsonPointer: "/status", expectedValue: "up", authMode: "header", headerName: "X-Api-Key", secret }))));
  assert.equal(created.status, 201);
  assert.equal(created.body.data.secretConfigured, true);
  assert.equal(created.body.data.expectedValue, "up");
  assert.equal(JSON.stringify(created.body).includes(secret), false);
  const id = created.body.data.id;
  touchedKeys.add(probeKeys.sync); touchedKeys.add(probeKeys.result(id));
  const renamed = await result(await handlers.externalServicePatch(request("/", "PATCH", { expectedRevision: 1, displayName: "Nome novo" }), params({ id })));
  assert.equal(renamed.status, 200); assert.equal(renamed.body.data.displayName, "Nome novo"); assert.equal(renamed.body.data.secretConfigured, true); assert.equal(renamed.body.data.revision, 2);
  assert.equal(JSON.stringify(renamed.body).includes(secret), false);
  assert.equal((await handlers.externalServicePatch(request("/", "PATCH", { expectedRevision: 1, displayName: "Atrasado" }), params({ id }))).status, 409);
  const calls = [];
  await runProbeCycle({ transport: async (url, method, headers) => { calls.push({ url: url.pathname, method, header: headers["X-Api-Key"] }); if (url.pathname.endsWith("/slow")) return { status: 200, body: "", latencyMs: 3000, certNotAfter: null }; if (url.pathname.endsWith("/denied")) return { status: 401, body: secret, latencyMs: 15, certNotAfter: null }; if (url.pathname.endsWith("/json")) return { status: 200, body: JSON.stringify({ status: "up" }), latencyMs: 40, certNotAfter: "2030-01-01T00:00:00.000Z" }; throw Object.assign(new Error("timeout"), { code: "ETIMEDOUT" }); } });
  assert.equal(calls.length, 1); assert.equal(calls[0].header, secret);
  const stored = await cache.get(probeKeys.result(id));
  assert.equal(stored.includes(secret), false); assert.equal(JSON.parse(stored).source, "probe"); assert.equal(JSON.parse(stored).data.reason, 0);
  assert.equal(await cache.get(keys.sync), syncBefore);
  const listed = await result(await handlers.externalServicesGet(request()));
  assert.equal(JSON.stringify(listed.body).includes(secret), false);
  const history = await result(await handlers.externalServiceHistoryGet(request("/?range=24h"), params({ id })));
  assert.equal(history.status, 200); assert.equal(history.body.data.points.length, 1); assert.equal(history.body.data.points[0].reason, 0); assert.equal(JSON.stringify(history.body).includes(secret), false);
  const column = await getDatabase().query("SELECT secret_ciphertext FROM external_service WHERE id = $1", [id]);
  assert.equal(column.rows[0].secret_ciphertext.includes(secret), false);
  const slow = await result(await handlers.externalServicePost(request("/", "POST", externalInput("/slow", { displayName: "Lento", timeoutMs: 5000 }))));
  const denied = await result(await handlers.externalServicePost(request("/", "POST", externalInput("/denied", { displayName: "Recusado" }))));
  const down = await result(await handlers.externalServicePost(request("/", "POST", externalInput("/down", { displayName: "Caido" }))));
  assert.equal(slow.status, 201); assert.equal(denied.status, 201); assert.equal(down.status, 201);
  for (const item of [slow, denied, down]) touchedKeys.add(probeKeys.result(item.body.data.id));
  await getDatabase().query("DELETE FROM external_service_sample");
  await runProbeCycle({ transport: async (url) => { if (url.pathname.endsWith("/slow")) return { status: 200, body: "", latencyMs: 4000, certNotAfter: null }; if (url.pathname.endsWith("/denied")) return { status: 401, body: "", latencyMs: 15, certNotAfter: null }; if (url.pathname.endsWith("/json")) return { status: 200, body: JSON.stringify({ status: "up" }), latencyMs: 40, certNotAfter: null }; throw Object.assign(new Error("timeout"), { code: "ETIMEDOUT" }); } });
  const latestReason = async serviceId => Number((await getDatabase().query("SELECT reason FROM external_service_sample WHERE service_id = $1 ORDER BY checked_at DESC, id DESC LIMIT 1", [serviceId])).rows[0]?.reason);
  assert.equal(await latestReason(slow.body.data.id), 1);
  assert.equal(await latestReason(denied.body.data.id), 2);
  assert.equal(await latestReason(down.body.data.id), 5);
  await markSyncFailure();
  assert.ok(await cache.get(probeKeys.result(id)));
  const overview = await result(await handlers.overviewGet(request()));
  assert.deepEqual(overview.body.data.highlightedResources.map(item => item.id), before.body.data.highlightedResources.map(item => item.id));
  assert.equal(overview.body.stale, true);
  assert.equal(overview.body.data.externalServices.length, 0);
  assert.deepEqual(overview.body.data.uptimeBoard, []);
  assert.equal((await handlers.externalServicePatch(request("/", "PATCH", { expectedRevision: 1, dashboardEnabled: true }), params({ id: slow.body.data.id }))).status, 200);
  const highlighted = await result(await handlers.overviewGet(request()));
  assert.deepEqual(highlighted.body.data.highlightedResources.map(item => item.id), before.body.data.highlightedResources.map(item => item.id));
  assert.equal(highlighted.body.data.highlightedResources.some(item => item.id === slow.body.data.id), false);
  assert.equal(highlighted.body.data.externalServices[0].id, slow.body.data.id);
  assert.equal(highlighted.body.stale, true);
  await getDatabase().query("ALTER TABLE external_service RENAME TO external_service_hidden_test");
  try {
    const isolated = await result(await handlers.overviewGet(request()));
    assert.equal(isolated.status, 200);
    assert.deepEqual(isolated.body.data.externalServices, []);
    assert.deepEqual(isolated.body.data.highlightedResources.map(item => item.id), before.body.data.highlightedResources.map(item => item.id));
  } finally { await getDatabase().query("ALTER TABLE external_service_hidden_test RENAME TO external_service"); }
  assert.equal((await handlers.externalServiceDelete(request("/", "DELETE"), params({ id }))).status, 204);
  assert.equal(Number((await getDatabase().query("SELECT COUNT(*)::int AS total FROM external_service_sample WHERE service_id = $1", [id])).rows[0].total), 0);
  await getDatabase().query("DELETE FROM external_service");
  await deleteResource(resource.id);
});

test("external history keeps one point per check and purge drops samples older than 30 days", async () => {
  const created = await result(await handlers.externalServicePost(request("/", "POST", externalInput("/history", { displayName: "Historico" }))));
  const id = created.body.data.id;
  const recent = new Date();
  const old = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000);
  await getPrisma().externalServiceSample.createMany({ data: [{ serviceId: id, checkedAt: recent, reason: 0, latencyMs: 100, httpStatus: 200 }, { serviceId: id, checkedAt: new Date(recent.getTime() - 1000), reason: 5, latencyMs: null, httpStatus: null }, { serviceId: id, checkedAt: new Date(recent.getTime() - 2000), reason: 2, latencyMs: 80, httpStatus: 401 }, { serviceId: id, checkedAt: old, reason: 0, latencyMs: 100, httpStatus: 200 }] });
  const history = await result(await handlers.externalServiceHistoryGet(request("/?range=30d"), params({ id })));
  assert.equal(history.body.data.points.length, 3);
  assert.equal(history.body.data.summary.averageLatencyMs, 90);
  assert.equal(history.body.data.summary.uptime30d.available, 1); assert.equal(history.body.data.summary.uptime30d.total, 3);
  await purgeExternalSamples(new AbortController().signal);
  const purged = await result(await handlers.externalServiceHistoryGet(request("/?range=30d"), params({ id })));
  assert.equal(purged.body.data.points.length, 3);
  assert.equal(Number((await getDatabase().query("SELECT COUNT(*)::int AS total FROM external_service_sample WHERE service_id = $1 AND checked_at < $2", [id, new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)])).rows[0].total), 0);
  assert.equal((await handlers.externalServiceHistoryGet(request("/?range=year"), params({ id }))).status, 400);
  await handlers.externalServiceDelete(request("/", "DELETE"), params({ id }));
});

test("service and stack IDs retain their PostgreSQL UUID defaults after migrations", async () => {
  const tables = ["external_service", "signal_service", "standalone_vps", "vps_stack"];
  const { rows } = await getDatabase().query(`
    SELECT table_name, column_default FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = ANY($1::text[]) AND column_name = 'id'
    ORDER BY table_name`, [tables]);
  assert.deepEqual(rows.map(row => row.table_name), tables);
  for (const row of rows) assert.equal(row.column_default, "gen_random_uuid()", row.table_name);
});

test("external registration rejects unsafe URLs and stops at 100 services", async () => {
  for (const url of ["https://127.0.0.1/health", "https://localhost/health", "https://169.254.169.254/latest", "https://1.1.1.1/health?x=1"]) assert.equal((await handlers.externalServicePost(request("/", "POST", externalInput("", { url })))).status, 400);
  await getDatabase().query("INSERT INTO external_service (display_name, method, url, success_mode, auth_mode) SELECT 'Limite ' || g, 'GET', 'https://1.1.1.1/limit/' || g, 'http_status', 'none' FROM generate_series(1, 100) AS g");
  const limited = await result(await handlers.externalServicePost(request("/", "POST", externalInput("/one-more"))));
  assert.equal(limited.status, 409); assert.equal(limited.body.error.code, "external_service_limit");
  await getDatabase().query("DELETE FROM external_service");
  const blocked = await getDatabase().query("INSERT INTO external_service (display_name, method, url, success_mode, auth_mode) VALUES ('Loop', 'GET', 'https://127.0.0.1/admin', 'http_status', 'none') RETURNING id");
  let consulted = 0;
  await runProbeCycle({ services: await listEnabledExternalServices(), transport: async () => { consulted += 1; return { status: 200, body: "", latencyMs: 1, certNotAfter: null }; } });
  assert.equal(consulted, 0);
  await getDatabase().query("DELETE FROM external_service WHERE id = $1", [blocked.rows[0].id]);
});

test("probe process defaults to 60s, refuses other intervals and does not take the template lock", async () => {
  touchedKeys.add(probeKeys.sync);
  const invalid = await runProbeProcess({ PROBE_INTERVAL_MS: "15000" });
  assert.equal(invalid.code, 1); assert.match(invalid.stderr, /probe_configuration_invalid/); assert.equal(invalid.stdout.includes("probe_cycle"), false);
  const fallback = await runProbeProcess({}, ["PROBE_INTERVAL_MS"]);
  assert.equal(fallback.code, 0, fallback.stderr); assert.match(fallback.stdout, /"intervalMs":60000/);
  const holder = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await holder.connect();
  assert.equal((await holder.query("SELECT pg_try_advisory_lock(734021007::bigint) AS locked")).rows[0].locked, true);
  try {
    const second = await runProbeProcess({ PROBE_INTERVAL_MS: "45000" });
    assert.equal(second.code, 1); assert.match(second.stderr, /probe_already_running/); assert.equal(second.stdout.includes("probe_cycle"), false);
    const template = new pg.Client({ connectionString: process.env.DATABASE_URL });
    await template.connect();
    await template.query("BEGIN"); await template.query("SET LOCAL statement_timeout = '2000ms'");
    await template.query("SELECT pg_advisory_xact_lock(734021005::bigint)"); await template.query("COMMIT"); await template.end();
  } finally { await holder.query("SELECT pg_advisory_unlock(734021007::bigint)"); await holder.end(); }
});

function runVpsMonitorProcess(overrides = {}, unset = []) {
  const env = { ...process.env, ...overrides };
  for (const key of unset) delete env[key];
  return new Promise(resolve => {
    const child = spawn(process.execPath, ["--conditions=react-server", "collector/vps-monitor.mjs", "--once"], { cwd: appRoot, env });
    let stdout = "", stderr = "";
    child.stdout.on("data", chunk => { stdout += chunk; });
    child.stderr.on("data", chunk => { stderr += chunk; });
    child.on("close", code => resolve({ code, stdout, stderr }));
  });
}
const vpsInput = (extra = {}) => ({ name: "Lab", ip: "10.8.0.4", ...extra });

test("standalone VPS registration keeps the monitor key local and does not change Zabbix resources", async t => {
  const resourcesBefore = Number((await getDatabase().query("SELECT COUNT(*)::int AS total FROM monitored_resource_config")).rows[0].total);
  const servicesBefore = Number((await getDatabase().query("SELECT COUNT(*)::int AS total FROM external_service")).rows[0].total);
  const vmsBefore = Number((await getDatabase().query("SELECT COUNT(*)::int AS total FROM vm_display_config")).rows[0].total);
  const syncBefore = await cache.get(keys.sync);
  const overviewBefore = await result(await handlers.overviewGet(request()));
  const secret = "vps-monitor-secret-value";
  const created = await result(await handlers.standaloneVpsPost(request("/", "POST", vpsInput())));
  assert.equal(created.status, 201);
  assert.equal(created.body.data.provider, null);
  assert.equal(created.body.data.monitorConfigured, false);
  assert.equal(created.body.data.monitorState, "not_configured");
  assert.deepEqual(created.body.data.strip, []);
  assert.equal(JSON.stringify(created.body).includes(secret), false);
  const id = created.body.data.id;
  const incomplete = await result(await handlers.standaloneVpsPatch(request("/", "PATCH", { expectedRevision: 1, baseUrl: "http://10.8.0.4:9100/monitor" }), params({ id })));
  assert.equal(incomplete.status, 422);
  assert.equal(incomplete.body.error.code, "monitor_incomplete");
  const monitored = await result(await handlers.standaloneVpsPatch(request("/", "PATCH", { expectedRevision: 1, baseUrl: "http://10.8.0.4:9100/monitor/", apiKey: secret, dashboardEnabled: true, provider: " Hostinger " }), params({ id })));
  assert.equal(monitored.status, 200);
  assert.equal(monitored.body.data.provider, "Hostinger");
  assert.equal(monitored.body.data.baseUrl, "http://10.8.0.4:9100/monitor");
  assert.equal(monitored.body.data.monitorConfigured, true);
  assert.equal(monitored.body.data.monitorState, "pending");
  assert.equal(monitored.body.data.apiKey, secret);
  assert.equal((await handlers.standaloneVpsPatch(request("/", "PATCH", { expectedRevision: 1, name: "Atrasado" }), params({ id }))).status, 409);
  const calls = [];
  const invalid = { id: randomUUID(), baseUrl: "https://192.0.2.42", apiKeyCiphertext: "invalid-key-envelope", timeoutMs: 5000 };
  const log = t.mock.method(console, "error", () => {});
  await runVpsMonitorCycle({ targets: [invalid, ...await listEnabledMonitoredVps()], transport: async url => { calls.push(url); throw new Error("unreachable"); } });
  assert.deepEqual(log.mock.calls.map(call => JSON.parse(call.arguments[0])), [
    { event: "vps_monitor_target_failed", targetRef: `standalone_vps:${invalid.id}`, reason: "vps_monitor_secret_unavailable" },
  ]);
  log.mock.restore();
  assert.deepEqual(calls, ["http://10.8.0.4:9100/monitor/ping/latency"]);
  const failed = await result(await handlers.standaloneVpsDetailGet(request("/"), params({ id })));
  assert.deepEqual(failed.body.data.samples, []);
  assert.equal(failed.body.data.reason, 5);
  assert.equal(failed.body.data.monitorState, "down");
  const withSamples = await result(await handlers.standaloneVpsDetailGet(request("/?samples=1"), params({ id })));
  assert.equal(withSamples.body.data.samples[0].reason, 5);
  assert.equal(failed.body.data.apiKey, secret);
  assert.equal(await cache.get(keys.sync), syncBefore);
  const paused = await result(await handlers.standaloneVpsPost(request("/", "POST", vpsInput({ name: "Pausada", ip: "10.8.0.5", enabled: false, baseUrl: "http://10.8.0.5/monitor", apiKey: secret }))));
  calls.length = 0;
  await runVpsMonitorCycle({ transport: async url => { calls.push(url); return { status: 200, body: "", latencyMs: 10 }; } });
  assert.equal(calls.some(url => url.includes("10.8.0.5")), false);
  const pausedRead = await result(await handlers.standaloneVpsDetailGet(request(), params({ id: paused.body.data.id })));
  assert.equal(pausedRead.body.data.monitorState, "inactive");
  assert.deepEqual(pausedRead.body.data.strip, []);
  const statusBody = JSON.stringify({ cpu: { load: "12,5%", cores: 2, coresLoad: [{ core: "0", load: "9%" }] }, memory: { total: "8 GB", used: "2 GB", free: "6 GB" }, disks: [{ device: "sda", use: "72%" }, { device: "sdb", use: "10%" }] });
  await runVpsMonitorCycle({ transport: async url => url.endsWith("/status") ? { status: 200, body: statusBody, latencyMs: 20 } : { status: 200, body: "", latencyMs: 40 } });
  touchedKeys.add(vpsResultKey(id));
  const stored = await cache.get(vpsResultKey(id));
  assert.equal(stored.includes(secret), false);
  assert.equal(stored.includes("10.8.0.4"), false);
  assert.equal(JSON.parse(stored).source, "vps");
  const ready = await result(await handlers.standaloneVpsDetailGet(request("/"), params({ id })));
  assert.equal(ready.body.data.monitorState, "up");
  assert.equal(ready.body.data.cpuPercent, 12.5);
  assert.equal(ready.body.data.diskPercent, 72);
  assert.equal(ready.body.data.result.cpu.cores, 2);
  assert.equal(ready.body.data.result.disks.length, 2);
  const stack = await result(await handlers.vpsStackPost(request("/", "POST", { name: "API", link: "https://10.8.0.4/api", notes: "fila principal" }), params({ id })));
  assert.equal(stack.status, 201);
  assert.equal((await handlers.vpsStackPatch(request("/", "PATCH", { notes: "fila nova" }), params({ id, stackId: stack.body.data.id }))).status, 200);
  const overview = await result(await handlers.overviewGet(request()));
  assert.equal(overview.body.data.standaloneVps.some(item => item.id === id), true);
  assert.equal(JSON.stringify(overview.body).includes(secret), false);
  assert.equal(overview.body.data.standaloneVps.some(item => item.id === paused.body.data.id), false);
  assert.deepEqual(overview.body.data.externalServices.map(item => item.id), overviewBefore.body.data.externalServices.map(item => item.id));
  assert.deepEqual(overview.body.data.problems.map(item => item.id ?? item.eventId ?? item), overviewBefore.body.data.problems.map(item => item.id ?? item.eventId ?? item));
  const old = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000);
  await getPrisma().vpsMonitorSample.create({ data: { vpsId: id, checkedAt: old, reason: 0, latencyMs: 10 } });
  await purgeVpsSamples(new AbortController().signal);
  assert.equal(Number((await getDatabase().query("SELECT COUNT(*)::int AS total FROM vps_monitor_sample WHERE vps_id = $1 AND checked_at < $2", [id, new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)])).rows[0].total), 0);
  assert.equal((await handlers.vpsStackDelete(request("/", "DELETE"), params({ id, stackId: stack.body.data.id }))).status, 204);
  assert.equal((await handlers.standaloneVpsDelete(request("/", "DELETE"), params({ id }))).status, 204);
  assert.equal((await handlers.standaloneVpsDelete(request("/", "DELETE"), params({ id: paused.body.data.id }))).status, 204);
  assert.equal(Number((await getDatabase().query("SELECT COUNT(*)::int AS total FROM monitored_resource_config")).rows[0].total), resourcesBefore);
  assert.equal(Number((await getDatabase().query("SELECT COUNT(*)::int AS total FROM external_service")).rows[0].total), servicesBefore);
  assert.equal(Number((await getDatabase().query("SELECT COUNT(*)::int AS total FROM vm_display_config")).rows[0].total), vmsBefore);
  assert.equal(await cache.get(keys.sync), syncBefore);
});

test("monitoring scope link adds host and VM, bumps revision, rejects stale write and non-editor", async () => {
  const { publishAgentDiscovery, discoveryKey } = await import("../../lib/server/cache/discovery.ts");
  const parent = { ...host("ASGARD"), role: "hypervisor", name: "ASGARD" };
  const vm = {
    vmKey: opaqueReference("vm", "ASGARD", "qemu/9003001"), vmId: "9003001", name: "vm-squad-ia-01",
    parentHostKey: "ASGARD", linuxHostKey: null, state: "running", metrics: {}, evidence: evidence(),
  };
  parent.vms = [vm];
  await getPrisma().pulseSetting.upsert({ where: { key: "asgardHostKey" }, update: { value: "ASGARD" }, create: { key: "asgardHostKey", value: "ASGARD" } });
  await getPrisma().pulseSetting.upsert({
    where: { key: "monitoringScope" },
    update: { value: { hostKeys: ["ASGARD"], vmLinks: [], revision: 1 } },
    create: { key: "monitoringScope", value: { hostKeys: ["ASGARD"], vmLinks: [], revision: 1 } },
  });
  await publish({ [keys.hosts]: [parent], [keys.host("ASGARD")]: parent });
  await publishAgentDiscovery({
    asgardHostKey: "ASGARD",
    candidates: [{ hostKey: "vm-squad-ia-01", displayName: "vm-squad-ia-01", agentAvailable: true, suggestedVm: { parentHostKey: "ASGARD", vmId: "qemu/9003001", vmKey: vm.vmKey, vmName: vm.name, match: "exact_name" } }],
  });
  touchedKeys.add(discoveryKey);

  const read = await result(await handlers.monitoringScopeGet(request("/settings/monitoring-scope")));
  assert.equal(read.status, 200);
  assert.equal(read.body.data.revision, 1);
  assert.equal(read.body.data.candidates.length, 1);
  assert.equal(read.body.data.unlinkedVms.length, 1);

  const linked = await result(await handlers.monitoringScopeLinkPost(request("/settings/monitoring-scope/links", "POST", {
    hostKey: "vm-squad-ia-01", parentHostKey: "ASGARD", vmId: "qemu/9003001", expectedRevision: 1,
  })));
  assert.equal(linked.status, 200);
  assert.equal(linked.body.data.revision, 2);
  assert.deepEqual(linked.body.data.hostKeys.sort(), ["ASGARD", "vm-squad-ia-01"]);
  assert.deepEqual(linked.body.data.vmLinks, [{ hostKey: "vm-squad-ia-01", parentHostKey: "ASGARD", vmId: "qemu/9003001" }]);

  const conflict = await result(await handlers.monitoringScopeLinkPost(request("/settings/monitoring-scope/links", "POST", {
    hostKey: "vm-squad-ia-01", parentHostKey: "ASGARD", vmId: "qemu/9003001", expectedRevision: 1,
  })));
  assert.equal(conflict.status, 409);
  assert.equal(conflict.body.error.code, "revision_conflict");

  const reader = sealEnvelope({ type: "access", token: "reader", user: { id: 7, email: "reader@pulse.test" }, sessionId: randomUUID(), expiresAt: Date.now() + 600000 });
  const forbidden = await result(await handlers.monitoringScopeLinkPost(request("/settings/monitoring-scope/links", "POST", {
    hostKey: "vm-squad-ia-01", parentHostKey: "ASGARD", vmId: "qemu/9003001", expectedRevision: 2,
  }, reader)));
  assert.equal(forbidden.status, 403);
  assert.equal(forbidden.body.error.code, "editor_required");

  const unlinked = await result(await handlers.monitoringScopeLinkDelete(request("/settings/monitoring-scope/links", "DELETE", {
    hostKey: "vm-squad-ia-01", expectedRevision: 2, removeHost: true,
  })));
  assert.equal(unlinked.status, 200);
  assert.equal(unlinked.body.data.revision, 3);
  assert.deepEqual(unlinked.body.data.hostKeys, ["ASGARD"]);
  assert.deepEqual(unlinked.body.data.vmLinks, []);
});

test("standalone VPS registration stops at 100 rows and a second monitor process does not collect", async () => {
  await getDatabase().query("INSERT INTO standalone_vps (name, ip) SELECT 'Limite ' || g, '10.9.0.' || ((g - 1) % 250 + 1) FROM generate_series(1, 100) AS g");
  const limited = await result(await handlers.standaloneVpsPost(request("/", "POST", vpsInput({ name: "Extra", ip: "10.9.1.1" }))));
  assert.equal(limited.status, 409);
  assert.equal(limited.body.error.code, "standalone_vps_limit");
  await getDatabase().query("DELETE FROM standalone_vps");
  const invalid = await runVpsMonitorProcess({ VPS_MONITOR_INTERVAL_MS: "15000" });
  assert.equal(invalid.code, 1);
  assert.match(invalid.stderr, /vps_monitor_configuration_invalid/);
  assert.equal(invalid.stdout.includes("vps_monitor_cycle"), false);
  const holder = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await holder.connect();
  assert.equal((await holder.query("SELECT pg_try_advisory_lock(734021009::bigint) AS locked")).rows[0].locked, true);
  try {
    const second = await runVpsMonitorProcess({ VPS_MONITOR_INTERVAL_MS: "45000" });
    assert.equal(second.code, 1);
    assert.match(second.stderr, /vps_monitor_already_running/);
    assert.equal(second.stdout.includes("vps_monitor_cycle"), false);
  } finally { await holder.query("SELECT pg_advisory_unlock(734021009::bigint)"); await holder.end(); }
});

function runSignalMonitorProcess(overrides = {}, unset = []) {
  const env = { ...process.env, ...overrides };
  for (const key of unset) delete env[key];
  return new Promise(resolve => {
    const child = spawn(process.execPath, ["--conditions=react-server", "collector/signal-monitor.mjs", "--once"], { cwd: appRoot, env });
    let stdout = "", stderr = "";
    child.stdout.on("data", chunk => { stdout += chunk; });
    child.stderr.on("data", chunk => { stderr += chunk; });
    child.on("close", code => resolve({ code, stdout, stderr }));
  });
}
const signalInput = (extra = {}) => ({ displayName: "Signal Squad", baseUrl: "https://api-signal-squad-ia-01.hostsoftcom.cloud", ...extra });

test("Signal targets CRUD, cycle, overview cards and lock stay isolated from Zabbix sync", async () => {
  const syncBefore = await cache.get(keys.sync);
  const overviewBefore = await result(await handlers.overviewGet(request()));
  const created = await result(await handlers.signalTargetPost(request("/", "POST", signalInput({ dashboardEnabled: true }))));
  assert.equal(created.status, 201);
  assert.equal(created.body.data.revision, 1);
  assert.equal(created.body.data.state, 4);
  const id = created.body.data.id;
  const renamed = await result(await handlers.signalTargetPatch(request("/", "PATCH", { expectedRevision: 1, displayName: "Signal Squad IA" }), params({ id })));
  assert.equal(renamed.status, 200);
  assert.equal(renamed.body.data.revision, 2);
  assert.equal((await handlers.signalTargetPatch(request("/", "PATCH", { expectedRevision: 1, displayName: "Atrasado" }), params({ id }))).status, 409);
  const linked = await result(await handlers.signalInfraLinkPost(request("/", "POST", {
    expectedRevision: 2, role: "manager", hostKey: "signal-unknown-host",
  }), params({ id })));
  assert.equal(linked.status, 201);
  assert.equal(linked.body.data.revision, 3);
  assert.equal(linked.body.data.links[0].inventoryStatus, "missing");
  const reader = sealEnvelope({ type: "access", token: "reader", user: { id: 7, email: "reader@pulse.test" }, sessionId: randomUUID(), expiresAt: Date.now() + 600000 });
  assert.equal((await handlers.signalTargetPost(request("/", "POST", signalInput({ displayName: "Reader" }), reader))).status, 403);
  const disabled = await result(await handlers.signalTargetPost(request("/", "POST", signalInput({ displayName: "Off", enabled: false, baseUrl: "https://api-signal-off.example" }))));
  const calls = [];
  await runSignalMonitorCycle({
    transport: async baseUrl => {
      calls.push(baseUrl);
      return {
        live: { ok: true, status: 200, latencyMs: 10, body: { status: "ok" } },
        ready: {
          ok: true, status: 200, latencyMs: 20,
          body: {
            status: "ok",
            checks: {
              database: "up", redis: "up", objectStorage: "up", workdeskAudio: "up",
              worker: { status: "up", activeInstances: 1, ageSeconds: 2 },
              pipeline: { outbox_pending: 0, outbox_dead: 0, inbox_pending: 0, inbox_dead: 0, oldest_outbox_seconds: 0, oldest_inbox_seconds: 0 },
              knowledgeIndex: { itemsFailed: 0, jobsFailedCurrent: 0, expiredLeases: 0, itemsWithoutActiveJob: 0 },
            },
          },
        },
      };
    },
  });
  assert.deepEqual(calls, ["https://api-signal-squad-ia-01.hostsoftcom.cloud"]);
  touchedKeys.add(signalKeys.result(id));
  touchedKeys.add(signalKeys.sync);
  const stored = JSON.parse(await cache.get(signalKeys.result(id)));
  assert.equal(stored.source, "signal-monitor");
  assert.equal(stored.data.state, 0);
  assert.equal(Array.isArray(stored.data.strip), true);
  assert.equal(stored.data.strip.length, 1);
  const detail = await result(await handlers.signalTargetGet(request(), params({ id })));
  assert.equal(detail.body.data.state, 0);
  assert.equal(detail.body.data.workerStatus, "up");
  const history = await result(await handlers.signalTargetHistoryGet(request("/?range=24h"), params({ id })));
  assert.equal(history.body.data.points.length, 1);
  const overview = await result(await handlers.overviewGet(request()));
  assert.equal(overview.body.data.signalCards.some(item => item.id === id), true);
  assert.equal(overview.body.data.signalCards.some(item => item.id === disabled.body.data.id), false);
  assert.deepEqual(overview.body.data.externalServices.map(item => item.id), overviewBefore.body.data.externalServices.map(item => item.id));
  assert.equal(await cache.get(keys.sync), syncBefore);
  const old = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000);
  await getPrisma().signalMonitorSample.create({ data: { targetId: id, checkedAt: old, state: 0, latencyMs: 10 } });
  await purgeSignalSamples(new AbortController().signal);
  assert.equal(Number((await getDatabase().query("SELECT COUNT(*)::int AS total FROM signal_monitor_sample WHERE target_id = $1 AND checked_at < $2", [id, new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)])).rows[0].total), 0);
  for (let i = 0; i < 8; i++) {
    await handlers.signalTargetPost(request("/", "POST", signalInput({ displayName: "Extra " + i, baseUrl: "https://api-signal-" + i + ".example" })));
  }
  const limited = await result(await handlers.signalTargetPost(request("/", "POST", signalInput({ displayName: "Over", baseUrl: "https://api-signal-over.example" }))));
  assert.equal(limited.status, 409);
  assert.equal(limited.body.error.code, "signal_target_limit");
  await getDatabase().query("DELETE FROM signal_target");
  const invalid = await runSignalMonitorProcess({ SIGNAL_MONITOR_INTERVAL_MS: "15000" });
  assert.equal(invalid.code, 1);
  assert.match(invalid.stderr, /signal_monitor_configuration_invalid/);
  const holder = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await holder.connect();
  assert.equal((await holder.query("SELECT pg_try_advisory_lock(734021011::bigint) AS locked")).rows[0].locked, true);
  try {
    const second = await runSignalMonitorProcess({ SIGNAL_MONITOR_INTERVAL_MS: "45000" });
    assert.equal(second.code, 1);
    assert.match(second.stderr, /signal_monitor_already_running/);
  } finally { await holder.query("SELECT pg_advisory_unlock(734021011::bigint)"); await holder.end(); }
});

test("VM Agent preferences share one resource, preserve availability identity and reject stale edits", async () => {
 const {readAgentMonitoring,saveAgentMonitoring}=await import("../../lib/server/config/agent-monitoring.ts");
 const {parent,vm}=namedVmFixture("agent-settings-parent","999");vm.linuxHostKey="agent-settings-host";
 const observed=new Date().toISOString(),until=new Date(Date.now()+600000).toISOString();
 const m=(value,unit="bytes")=>({value,unit,quality:"fresh",observedAt:observed,validUntil:until});
 const agent={...host(vm.linuxHostKey),role:"linux",metrics:{cpuUsagePercent:m(10,"percent"),memoryUsagePercent:m(20,"percent")},filesystems:[{key:opaqueReference("device",vm.linuxHostKey,"filesystems","/"),name:"/",metrics:{diskUsedBytes:m(80),diskTotalBytes:m(100)}},{key:opaqueReference("device",vm.linuxHostKey,"filesystems","/data"),name:"/data",metrics:{diskUsedBytes:m(20),diskTotalBytes:m(400)}}]};
 await publish({[keys.hosts]:[parent,agent],[keys.host(agent.hostKey)]:agent});
 const first=await readAgentMonitoring(agent.hostKey);assert.equal(first.resourceId,null);assert.equal(first.revision,0);
 const input={expectedRevision:0,vmBinding:{parentHostKey:parent.hostKey,vmKey:vm.vmKey},capacity:{filesystemKeys:agent.filesystems.map(f=>f.key),independentVolumesConfirmed:true},thresholds:{cpu:70,memory:null,disk:70},cardMetrics:["cpu","disk"],critical:true};
 const outcomes=await Promise.allSettled([saveAgentMonitoring(agent.hostKey,input),saveAgentMonitoring(agent.hostKey,input)]);
 assert.equal(outcomes.filter(x=>x.status==="fulfilled").length,1);assert.equal(outcomes.find(x=>x.status==="rejected").reason.code,"revision_conflict");
 const data=await readAgentMonitoring(agent.hostKey);assert.equal(data.capacity.usagePercent.value,20);assert.equal(data.settings.thresholds.disk,70);
 const resource=await getResource(data.resourceId);assert.equal(resource.dashboardEnabled,false);assert.deepEqual(resource.presentation.cardMetrics,["cpu","disk"]);
 assert.equal(resource.presentation.showCpu,true);assert.equal(resource.presentation.showMemory,false);assert.equal(resource.presentation.showDisk,true);
 await assert.rejects(()=>saveAgentMonitoring(agent.hostKey,input),error=>error.code==="revision_conflict");
 const epoch=(await getDatabase().query("SELECT epoch FROM notification_target_state WHERE target_ref=$1 AND condition_key='$lifecycle'",["resource:"+resource.id])).rows[0].epoch;
 const changed=await updateResource(resource.id,{expectedRevision:data.revision,description:"Kept preferences",presentation:{showCpu:true}});
 assert.equal(changed.agentMonitoring.thresholds.disk,70);assert.deepEqual(changed.presentation.cardMetrics,["cpu","disk"]);
 await assert.rejects(()=>saveAgentMonitoring(agent.hostKey,{...input,expectedRevision:data.revision}),error=>error.code==="revision_conflict");
 const next=await saveAgentMonitoring(agent.hostKey,{...input,expectedRevision:changed.revision,thresholds:{cpu:80,memory:null,disk:70}});
 assert.equal(next.settings.thresholds.cpu,80);assert.equal((await getDatabase().query("SELECT epoch FROM notification_target_state WHERE target_ref=$1 AND condition_key='$lifecycle'",["resource:"+resource.id])).rows[0].epoch,epoch);
 const hosts=(await handlers.hostsGet(request()).then(r=>r.json())).data;
 assert.equal(hosts.find(h=>h.hostKey===agent.hostKey).agentCard.capacity.usagePercent.value,20);
 const diskOnly={...input,expectedRevision:next.revision,capacity:{filesystemKeys:[],independentVolumesConfirmed:false},thresholds:{cpu:null,memory:null,disk:52},cardMetrics:["cpu","memory"],metricsSource:"hypervisor"};
 const {protectedResponse}=await import("../../lib/server/bff.ts");
 const invalid=await protectedResponse(request("/settings/agent-monitoring/"+agent.hostKey,"PUT",diskOnly),()=>saveAgentMonitoring(agent.hostKey,diskOnly));
 assert.equal(invalid.status,400);assert.equal((await invalid.json()).error.code,"capacity_required");
 assert.equal((await getResource(resource.id)).revision,next.revision);
 const onlyDisk=await saveAgentMonitoring(agent.hostKey,{...diskOnly,capacity:{filesystemKeys:[agent.filesystems[0].key],independentVolumesConfirmed:false}});
 assert.deepEqual(onlyDisk.settings.thresholds,{cpu:null,memory:null,disk:52});assert.deepEqual(onlyDisk.cardMetrics,["cpu","memory"]);
 const swapped=await saveAgentMonitoring(agent.hostKey,{...diskOnly,expectedRevision:onlyDisk.revision,capacity:onlyDisk.settings.capacity,cardMetrics:["disk","memory"]});
 const swappedResource=await getResource(resource.id);
 assert.equal(swappedResource.presentation.showCpu,false);assert.equal(swappedResource.presentation.showMemory,true);assert.equal(swappedResource.presentation.showDisk,true);
 const fixedLegacy=await updateResource(resource.id,{expectedRevision:swapped.revision,presentation:{...swappedResource.presentation,showCpu:true,showMemory:false,showDisk:true}});
 assert.deepEqual(fixedLegacy.presentation.cardMetrics,["cpu","disk"]);assert.equal(fixedLegacy.presentation.showCpu,true);assert.equal(fixedLegacy.presentation.showMemory,false);
 assert.deepEqual(fixedLegacy.agentMonitoring,swappedResource.agentMonitoring);assert.equal(fixedLegacy.critical,swappedResource.critical);
 const reread=await readAgentMonitoring(agent.hostKey);assert.deepEqual(reread.cardMetrics,["cpu","disk"]);
 assert.equal((await getDatabase().query("SELECT epoch FROM notification_target_state WHERE target_ref=$1 AND condition_key='$lifecycle'",["resource:"+resource.id])).rows[0].epoch,epoch);
 const {getPrisma:prismaClient}=await import("../../lib/server/prisma.ts");
 const legacyRow=await prismaClient().monitoredResourceConfig.update({where:{id:resource.id},data:{presentation:{showCpu:true,showMemory:false,showDisk:true,metricsSource:"hypervisor"}}});
 const legacyRead=await readAgentMonitoring(agent.hostKey);assert.deepEqual(legacyRead.cardMetrics,["cpu","disk"]);
 assert.equal((await getResource(resource.id)).revision,legacyRow.revision);
 const sealed=await saveAgentMonitoring(agent.hostKey,{...diskOnly,expectedRevision:legacyRead.revision,capacity:legacyRead.settings.capacity,thresholds:legacyRead.settings.thresholds,cardMetrics:legacyRead.cardMetrics});
 const sealedResource=await getResource(resource.id);assert.deepEqual(sealedResource.presentation.cardMetrics,["cpu","disk"]);
 assert.equal(sealedResource.presentation.showCpu,true);assert.equal(sealedResource.presentation.showMemory,false);assert.equal(sealedResource.presentation.showDisk,true);
 assert.deepEqual(sealedResource.agentMonitoring,fixedLegacy.agentMonitoring);
 const triple=await saveAgentMonitoring(agent.hostKey,{...diskOnly,expectedRevision:sealed.revision,capacity:legacyRead.settings.capacity,thresholds:legacyRead.settings.thresholds,cardMetrics:["cpu","memory","disk"]});
 assert.deepEqual((await getResource(resource.id)).presentation.cardMetrics,["cpu","memory","disk"]);
 assert.deepEqual((await readAgentMonitoring(agent.hostKey)).cardMetrics,["cpu","memory","disk"]);
 assert.deepEqual(triple.settings.thresholds,sealed.settings.thresholds);
 assert.equal((await getDatabase().query("SELECT epoch FROM notification_target_state WHERE target_ref=$1 AND condition_key='$lifecycle'",["resource:"+resource.id])).rows[0].epoch,epoch);
 await deleteResource(resource.id,triple.revision);
});

test("monitor text scales persist per block and screen through private and public presentation reads", async () => {
  const previous = (await getPresentation()).data, hosts = process.env.PULSE_PUBLIC_HOSTS, demo = process.env.PULSE_DEMO_MODE;
  try {
    const { revision: ignored, ...settings } = initialV2(randomUUID); void ignored;
    settings.screens.push(initialV2(randomUUID).screens[0]);
    settings.screens[0].blocks[1].monitorFontScalePercent = 115;
    settings.screens[1].blocks[1].monitorFontScalePercent = 200;
    const saved = await savePresentation({ expectedRevision: previous.revision, settings });
    const privateRead = (await getPresentation()).data;
    assert.deepEqual(privateRead.screens.map(screen => screen.blocks.map(block => block.monitorFontScalePercent)), [[undefined,115,undefined,undefined],[undefined,200,undefined,undefined]]);
    process.env.PULSE_PUBLIC_HOSTS = "fonts.example.test"; process.env.PULSE_DEMO_MODE = "0";
    const response = await publicGet(new Request("http://fonts.example.test/api/public/settings/presentation", {headers:{Host:"fonts.example.test"}}), ["settings","presentation"]);
    assert.equal(response.status, 200);
    assert.deepEqual((await response.json()).data.screens, privateRead.screens);
    const invalid = structuredClone(settings); invalid.screens[1].blocks[1].monitorFontScalePercent = 205;
    await assert.rejects(savePresentation({expectedRevision:saved.data.revision,settings:invalid}), error => error.name === "ZodError");
    assert.equal((await getPresentation()).data.revision, saved.data.revision);
  } finally {
    if(hosts===undefined) delete process.env.PULSE_PUBLIC_HOSTS; else process.env.PULSE_PUBLIC_HOSTS=hosts;
    if(demo===undefined) delete process.env.PULSE_DEMO_MODE; else process.env.PULSE_DEMO_MODE=demo;
    const {revision:ignored,...settings}=previous; void ignored;
    await savePresentation({expectedRevision:(await getPresentation()).data.revision,settings});
  }
});
