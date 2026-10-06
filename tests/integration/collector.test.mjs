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
import { createResource, updateResource, deleteResource, listResources } from "../../lib/server/config/repository.ts";
import { readContainers, readOverview, readHost } from "../../lib/server/monitoring/read.ts";
import { overviewGet, hostHistoryGet } from "../../lib/server/monitoring/handlers.ts";
import { zabbixFixture, addProvisionedCpuItems } from "../fixtures/zabbix.mjs";

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
  const tables = await getDatabase().query("SELECT table_name FROM information_schema.tables WHERE table_schema='public' ORDER BY table_name"); assert.deepEqual(tables.rows.map(r => r.table_name), ["_prisma_migrations", "monitored_resource_config", "pulse_settings", "vm_template_config"]);
});
