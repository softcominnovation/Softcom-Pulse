import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID, randomBytes } from "node:crypto";
import pg from "pg";
import { createClient } from "redis";
import { withMigrationLock } from "../../docker/migration-lock.mjs";
import { runMigrationProcess } from "../../docker/migrate.mjs";
import { getPrisma } from "../../lib/server/prisma.ts";
import { getDatabase } from "../../lib/server/database.ts";
import { sealEnvelope } from "../../lib/server/auth/envelope.ts";
import { collectSnapshots } from "../../lib/server/zabbix/collect.ts";
import { createCycle } from "../../collector/worker.ts";
import { publishSnapshots, readSnapshotBatch, markSyncFailure, snapshotKeys as keys } from "../../lib/server/cache/snapshots.ts";
import { discoveryKey } from "../../lib/server/cache/discovery.ts";
import { createResource, updateResource, deleteResource, listResources } from "../../lib/server/config/repository.ts";
import { readContainers, readOverview, readHost } from "../../lib/server/monitoring/read.ts";
import { overviewGet, hostHistoryGet } from "../../lib/server/monitoring/handlers.ts";
import { zabbixFixture, addProvisionedCpuItems, addClusterStatusHeartbeat } from "../fixtures/zabbix.mjs";
import { storageFixture } from "../fixtures/storage.mjs";
import { storageKey } from "../../lib/server/zabbix/storage.ts";
import { saveStorageConfig } from "../../lib/server/config/storages.ts";
import { readStorages } from "../../lib/server/monitoring/storages.ts";
import { getPresentation, savePresentation } from "../../lib/server/config/repository.ts";
import { storagesGet, storageGet, storageSettingsGet, storageSettingsPut } from "../../lib/server/monitoring/handlers.ts";
import { publicGet } from "../../lib/server/monitoring/public-handlers.ts";

let admin, cache, created = false, owned = false, token;
const databaseName = "pulse_phase04_test_" + process.pid + "_" + Date.now(), leaseKey = "pulse:test:phase04:lease", lease = randomUUID();
const touched = new Set([keys.sync]);
const env = { ...process.env };
async function publish(entries, ...args) { Object.keys(entries).forEach(key => touched.add(key)); return publishSnapshots(entries, ...args); }
const request = () => new Request("http://localhost/api/dashboard/overview", { headers: { Authorization: "Bearer " + token } });
before(async () => {
  const db = new URL(process.env.DATABASE_URL), redis = new URL(process.env.REDIS_URL);
  for (const target of [db, redis]) assert.ok(["127.0.0.1", "localhost", "[::1]"].includes(target.hostname));
  db.pathname = "/postgres"; admin = new pg.Client({ connectionString: db.href }); await admin.connect();
  await admin.query('CREATE DATABASE "' + databaseName + '"'); created = true;
  db.pathname = "/" + databaseName; process.env.DATABASE_URL = db.href;
  await withMigrationLock({ connectionString: db.href, execute: signal => runMigrationProcess(signal) });
  redis.pathname = "/13"; process.env.REDIS_URL = redis.href;
  cache = createClient({ url: redis.href }); cache.on("error", () => {}); await cache.connect();
  assert.equal(await cache.set(leaseKey, lease, { NX: true, EX: 600 }), "OK"); owned = true;
  assert.equal(await cache.dbSize(), 1, "Redis DB 13 must be empty; existing data is preserved");
  const f = zabbixFixture();
  for (const [key, value] of [["monitoringScope", f.scope.scope], ["asgardHostKey", "ASGARD"]]) await getPrisma().pulseSetting.create({ data: { key, value } });
  process.env.TOKEN_ENCRYPTION_KEY = randomBytes(32).toString("base64");
  token = sealEnvelope({ type: "access", token: "fixture-only", user: { id: 42 }, sessionId: randomUUID(), expiresAt: Date.now() + 600000 });
}, { timeout: 45000 });
after(async () => {
  await globalThis.pulsePrisma?.$disconnect(); await globalThis.pulseDatabase?.end();
  if (globalThis.pulseCache?.isOpen) globalThis.pulseCache.destroy();
  if (cache?.isReady) { if (owned && await cache.get(leaseKey) === lease) { await cache.del([...touched]); await cache.del(leaseKey); } await cache.quit(); }
  if (admin) { assert.match(databaseName, /^pulse_phase04_test_\d+_\d+$/); if (created) await admin.query('DROP DATABASE "' + databaseName + '" WITH (FORCE)'); await admin.end(); }
  for (const key of ["DATABASE_URL", "REDIS_URL", "TOKEN_ENCRYPTION_KEY"]) if (env[key] === undefined) delete process.env[key]; else process.env[key] = env[key];
});
test("collector publishes agent discovery without changing the heavy scope inventory", async () => {
  const f = zabbixFixture();
  f.hosts.push({ hostid: "4", host: "VM-without-Agent", name: "VM-without-Agent", status: "0", tags: [], interfaces: [{ type: "1", main: "1", available: "1" }], hostgroups: [] });
  const cycle = createCycle({
    collect: () => collectSnapshots({ rpc: f.rpc }),
    publish,
    publishDiscovery: async data => {
      const { publishAgentDiscovery } = await import("../../lib/server/cache/discovery.ts");
      touched.add(discoveryKey);
      await publishAgentDiscovery(data);
    },
    fail: markSyncFailure,
  });
  assert.equal(await cycle(), true);
  const raw = await cache.get(discoveryKey);
  assert.ok(raw);
  const envelope = JSON.parse(raw);
  assert.equal(envelope.source, "zabbix");
  assert.equal(envelope.data.candidates[0].hostKey, "VM-without-Agent");
  assert.equal((await readSnapshotBatch([keys.hosts])).snapshots.get(keys.hosts)?.data.length, 2);
});

test("whole collector generation feeds authenticated BFF while technical mappings stay private", async () => {
  const f = zabbixFixture(); addProvisionedCpuItems(f);
  const { entries } = await collectSnapshots({ rpc: f.rpc }); await publish(entries);
  const response = await overviewGet(request()); assert.equal(response.status, 200);
  const body = await response.json(); assert.equal(body.data.summary.vms, 2); assert.equal(body.data.summary.containersStopped, 4); assert.equal(body.stale, false);
  assert.ok(!JSON.stringify(body).includes("itemid")); assert.ok(!JSON.stringify(body).includes("hostid"));
  const batch = await readSnapshotBatch(Object.keys(entries));
  for (const value of batch.snapshots.values()) assert.equal(value.generation, batch.generation);
  const before = f.calls.length;
  await readOverview(); await readContainers(); await readHost("ASGARD"); assert.equal(f.calls.length, before);
  const agent = await readHost("linux-a");
  assert.equal(agent.data.metrics.osCpuCount.value, 4);
  assert.equal(agent.data.metrics.osCpuCount.unit, "count");
  const hypervisor = await readHost("ASGARD");
  assert.equal(hypervisor.data.vms[0].metrics.provisionedCpuCount.value, 8);
  assert.equal(hypervisor.data.vms[1].metrics.provisionedCpuCount.value, 16);
  assert.equal(hypervisor.data.vms[1].linuxHostKey, null);
  assert.equal(hypervisor.data.vms[0].metrics.osCpuCount, undefined);
  assert.ok(!JSON.stringify(agent).includes("itemid"));
  const unauth = await hostHistoryGet(new Request("http://localhost/api/monitoring/hosts/ASGARD/history"), { params: Promise.resolve({ hostKey: "ASGARD" }) }); assert.equal(unauth.status, 401);
});
test("partial collection failure keeps the prior generation and TTL while recording attempt and safe error", async () => {
  const f = zabbixFixture(); const { entries } = await collectSnapshots({ rpc: f.rpc }); await publish(entries);
  const before = await cache.get(keys.hosts), syncBefore = await readSnapshotBatch([]), ttlBefore = await cache.pTTL(keys.hosts);
  const cycle = createCycle({ collect: () => collectSnapshots({ rpc: async (m, p) => { if (m === "problem.get") throw new Error("private origin details"); return f.rpc(m, p); } }), publish, fail: markSyncFailure });
  assert.equal(await cycle(), false);
  assert.equal(await cache.get(keys.hosts), before); assert.ok(await cache.pTTL(keys.hosts) <= ttlBefore);
  const after = await readSnapshotBatch([]); assert.equal(after.generation, syncBefore.generation); assert.equal(after.sync.lastSuccessfulAt, syncBefore.sync.lastSuccessfulAt); assert.equal(after.sync.status, "failed"); assert.equal(after.sync.error, "collection_failed"); assert.ok(after.sync.lastAttemptAt);
  assert.equal((await readOverview()).stale, true); assert.equal((await readContainers()).data[0].health, "unknown");
  const response = await overviewGet(request()); assert.equal(response.status, 200); assert.equal((await response.json()).stale, true);
});

test("the BFF preserves ASGARD availability between stored heartbeats and expires only overdue evidence", async () => {
  const f = zabbixFixture(), { online } = addClusterStatusHeartbeat(f);
  await publish((await collectSnapshots({ rpc: f.rpc })).entries);
  const response = await overviewGet(request()), body = await response.json();
  assert.equal(response.status, 200);
  const asgard = body.data.blocks.find(block => block.type === "asgard_summary").data.host;
  assert.equal(body.stale, false);
  assert.equal(asgard.availability, "reachable");
  assert.ok(Date.parse(asgard.evidence.validUntil) > Date.now());
  assert.equal((await readHost("ASGARD")).data.availability, "reachable");
  online.lastclock = String(Math.floor(Date.now() / 1000) - 1000);
  await publish((await collectSnapshots({ rpc: f.rpc })).entries);
  assert.equal((await readHost("ASGARD")).data.availability, "unknown");
  online.lastvalue = "0"; online.lastclock = String(Math.floor(Date.now() / 1000));
  await publish((await collectSnapshots({ rpc: f.rpc })).entries);
  assert.equal((await readHost("ASGARD")).data.availability, "unreachable");
});
test("dead collector and TTL expiry cannot produce healthy empty dashboards", async () => {
  const f = zabbixFixture(); const { entries } = await collectSnapshots({ rpc: f.rpc });
  await publish(entries, new Date(Date.now() - 70000).toISOString());
  assert.equal((await readOverview()).stale, true); assert.equal((await readContainers()).data[0].health, "unknown");
  for (const key of [...Object.keys(entries), keys.sync]) await cache.pExpire(key, 1);
  await new Promise(resolve => setTimeout(resolve, 10));
  const empty = await readOverview(); assert.equal(empty.availability, "no_data"); assert.equal(empty.data.summary.hostsKnown, null);
  await markSyncFailure("zabbix_unavailable"); assert.equal((await readOverview()).stale, true);
});
test("disabled or deleted configuration is immediately excluded, and a disappeared target leaves its human record", async () => {
  const f = zabbixFixture(); await publish((await collectSnapshots({ rpc: f.rpc })).entries);
  const config = await createResource({ resourceType: "docker_container", zabbixHostKey: "linux-a", selectorType: "name_prefix", selectorValue: "service", dashboardEnabled: true, presentation: { showHealth: true } });
  await publish((await collectSnapshots({ rpc: f.rpc })).entries); assert.equal((await readOverview()).data.highlightedResources.length, 1);
  await updateResource(config.id, { enabled: false }); assert.equal((await readOverview()).data.highlightedResources.length, 0);
  await updateResource(config.id, { enabled: true });
  f.items = f.items.filter(i => !i.tags.some(t => t.tag === "container"));
  const absent = zabbixFixture(); absent.items.splice(0, absent.items.length, ...f.items);
  await publish((await collectSnapshots({ rpc: absent.rpc })).entries);
  assert.equal((await readOverview()).data.highlightedResources[0].resolution, "missing"); assert.equal((await listResources()).length, 1);
  await deleteResource(config.id); assert.equal((await readOverview()).data.highlightedResources.length, 0);
  const next = (await collectSnapshots({ rpc: absent.rpc })).entries; await publish(next);
  assert.equal((await readSnapshotBatch([keys.service(config.id)])).snapshots.get(keys.service(config.id)), null);
  const tables = await getDatabase().query("SELECT table_name FROM information_schema.tables WHERE table_schema='public' ORDER BY table_name"); assert.deepEqual(tables.rows.map(r => r.table_name), ["_prisma_migrations", "external_service", "external_service_sample", "monitored_resource_config", "notification_change", "notification_event", "notification_incident", "notification_stream_state", "notification_target_state", "pulse_settings", "signal_infra_link", "signal_monitor_sample", "signal_service", "signal_target", "standalone_vps", "storage_config", "vm_display_config", "vm_template_config", "vps_monitor_sample", "vps_stack"]);
});

test("Storage migration, revisioned preferences, isolated snapshots and authenticated/public BFF agree", async () => {
  const f = storageFixture(), key = storageKey(f.host.hostid);
  const previousEditors = process.env.PULSE_EDITOR_EMAILS, previousHosts = process.env.PULSE_PUBLIC_HOSTS;
  process.env.PULSE_EDITOR_EMAILS = "storage-editor@example.test"; process.env.PULSE_PUBLIC_HOSTS = "localhost";
  const editorToken = sealEnvelope({ type: "access", token: "fixture-only", user: { id: 77, email: "storage-editor@example.test" }, sessionId: randomUUID(), expiresAt: Date.now() + 600000 });
  const req = (path, body, auth = editorToken) => new Request(`http://localhost/api/${path}`, { method: body ? "PUT" : "GET", headers: { Host: "localhost", ...(auth ? { Authorization: `Bearer ${auth}` } : {}), ...(body ? { "Content-Type": "application/json" } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
  const context = { params: Promise.resolve({ storageKey: key }) };
  try {
    const result = await collectSnapshots({ rpc: f.rpc }); await publish(result.entries);
    const advertised = JSON.parse(await cache.get(keys.sync)).data;
    assert.equal(advertised.keys.includes(keys.storages), false);
    assert.deepEqual(advertised.extensionKeys, [keys.storages]);
    // The old Web allowlist sees only its original keys; new Web resolves the
    // extension in the same generation without changing primary DTOs.
    assert.ok(advertised.keys.every(key => /^pulse:(?:snapshot:(?:overview|host:.+|service:.+)|inventory:(?:hosts|containers:.+)|problems:current|source:bindings)$/.test(key)));
    const generation = await readSnapshotBatch([keys.hosts, keys.storages]);
    assert.equal(generation.snapshots.get(keys.hosts).generation, generation.snapshots.get(keys.storages).generation);
    const scopeBefore = await getPrisma().pulseSetting.findUnique({ where: { key: "monitoringScope" } });
    let list = await readStorages(); assert.equal(list.data.items.length, 1); assert.equal(list.data.items[0].configId, null);
    assert.equal((await storagesGet(req("monitoring/storages", null, null))).status, 401);
    assert.equal((await storageSettingsGet(req("settings/storages", null, token))).status, 403);
    assert.equal((await storageSettingsPut(req(`settings/storages/${key}`, { expectedRevision: 0 }, token), context)).status, 403);
    const concurrent = await Promise.all([saveStorageConfig(key, { expectedRevision: 0, displayName: "Archive One", dashboardEnabled: true }), saveStorageConfig(key, { expectedRevision: 0, displayName: "Concurrent" })].map(promise => promise.then(value => ({ value }), error => ({ error }))));
    assert.equal(concurrent.filter(result => result.value).length, 1); assert.equal(concurrent.find(result => result.error).error.status, 409);
    const config = concurrent.find(result => result.value).value;
    assert.equal(config.zabbixHostId, "77"); assert.equal(config.revision, 1);
    list = await readStorages(); assert.equal(list.data.items[0].configId, config.id);
    const volumes = list.data.items[0].volumes;
    const invalid = await storageSettingsPut(req(`settings/storages/${key}`, { expectedRevision: 1, filesystemKeys: volumes.map(item => item.key) }), context); assert.equal(invalid.status, 400);
    const updated = await saveStorageConfig(key, { expectedRevision: 1, displayName: "Archive One", dashboardEnabled: true, filesystemKeys: volumes.map(item => item.key), independentVolumesConfirmed: true }); assert.equal(updated.revision, 2);
    const p = (await getPresentation()).data, { revision, ...settings } = p;
    settings.schemaVersion = 2; settings.screens[0].blocks.push({ id: randomUUID(), type: "storage_summary", enabled: true, width: "wide", options: { storageConfigId: config.id, visibleRows: 3 } });
    await savePresentation({ expectedRevision: revision, settings });
    const overview = await readOverview(); assert.equal(overview.data.blocks.find(block => block.type === "storage_summary").data.target.displayName, "Archive One");
    const pubReq = path => new Request(`http://localhost/api/public/${path}`, { headers: { Host: "localhost" } });
    for (const path of ["monitoring/storages", `monitoring/storages/${key}`, "dashboard/overview"]) {
      const response = await publicGet(pubReq(path), path.split("/")); assert.equal(response.status, 200);
      const body = await response.json();
      const serialized = JSON.stringify(path === "dashboard/overview" ? body.data.blocks.filter(block => block.type === "storage_summary" || block.type === "highlighted_resources") : body);
      assert.ok(!serialized.includes("hostid")); assert.ok(!serialized.includes("zabbixHostId")); assert.ok(!serialized.includes('"name":"/data"')); assert.ok(!serialized.includes('"name":"eth0"')); assert.ok(!serialized.includes("role"));
    }
    assert.equal((await publicGet(pubReq("settings/storages"), ["settings", "storages"])).status, 404);
    assert.equal((await publicGet(new Request("http://forbidden/api/public/monitoring/storages", { headers: { Host: "forbidden" } }), ["monitoring", "storages"])).status, 403);
    assert.equal((await storageGet(req(`monitoring/storages/${key}`), context)).status, 200);
    const broken = await collectSnapshots({ rpc: async (method, params) => { if (method === "host.get" && params.tags) throw new Error("private origin failure"); return f.rpc(method, params); } });
    await publish(broken.entries);
    assert.equal((await readStorages()).data.status, "failed"); assert.equal((await readStorages()).data.items[0].stale, true);
    const unaffected = await readOverview(); assert.equal(unaffected.stale, false); assert.equal(unaffected.data.blocks.find(block => block.type === "asgard_summary").stale, false);
    await assert.rejects(saveStorageConfig(key, { expectedRevision: 2, networkInterfaceKey: list.data.items[0].interfaces[0].key }), error => error.code === "storage_inventory_unavailable");
    f.host.tags = [];
    await publish((await collectSnapshots({ rpc: f.rpc })).entries);
    assert.equal((await readStorages()).data.orphans[0].resolution, "tag_missing");
    const reset = await saveStorageConfig(key, { expectedRevision: 2 }); assert.equal(reset.id, config.id); assert.equal(reset.revision, 3);
    const scopeAfter = await getPrisma().pulseSetting.findUnique({ where: { key: "monitoringScope" } }); assert.deepEqual(scopeAfter.value, scopeBefore.value);
    const rows = await getDatabase().query("SELECT column_name FROM information_schema.columns WHERE table_name='storage_config'"); assert.ok(!rows.rows.some(row => /metric|availability|cpu|memory|tags/.test(row.column_name)));
  } finally {
    if (previousEditors === undefined) delete process.env.PULSE_EDITOR_EMAILS; else process.env.PULSE_EDITOR_EMAILS = previousEditors;
    if (previousHosts === undefined) delete process.env.PULSE_PUBLIC_HOSTS; else process.env.PULSE_PUBLIC_HOSTS = previousHosts;
  }
});
