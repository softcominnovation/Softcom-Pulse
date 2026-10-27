import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { storageFixture } from "./fixtures/storage.mjs";
import { isStorageHost, storageKey, normalizeStorage, collectStorage } from "../lib/server/zabbix/storage.ts";
import { collectSnapshots } from "../lib/server/zabbix/collect.ts";
import { storageCapacity, storageStatus, publicStorage } from "../lib/storage/presentation.ts";
import { storageLayout } from "../lib/dashboard/layout.ts";
import { storagePreferencesSchema, storageWriteSchema } from "../lib/config/storages.ts";
import { effectiveOptions } from "../lib/config/presentation.ts";
import { playableScreens } from "../lib/dashboard/player.ts";
import { buildCustomAvailabilityCards, buildDefaultAvailabilityCards } from "../lib/dashboard/availability-cards.ts";

test("storage classification is the exact host tag, independent of any machine identity", () => {
  for (const tags of [[], [{ tag: "Role", value: "storage" }], [{ tag: "role", value: "Storage" }], [{ tag: "role", value: "storage " }], [{ tag: "component", value: "storage" }]]) assert.equal(isStorageHost({ tags }), false);
  assert.equal(isStorageHost({ tags: [{ tag: "role", value: "worker" }, { tag: "role", value: "storage" }] }), true);
  assert.notEqual(storageKey("1"), storageKey("2"));
});
test("outside-scope Storage reuses the Collector, preserves scope/counts and fetches no raw/Docker values", async () => {
  const f = storageFixture();
  const result = await collectSnapshots({ rpc: f.rpc, scope: f.scope, configs: [], now: f.now });
  assert.equal(result.counts.hosts, 2);
  assert.equal(result.entries["pulse:inventory:hosts"].length, 2);
  const snapshot = result.entries["pulse:inventory:storages"];
  assert.equal(snapshot.status, "ok"); assert.equal(snapshot.items.length, 1);
  const item = snapshot.items[0];
  assert.equal(item.metrics.cpuUsagePercent.value, 25); assert.equal(item.metrics.memoryUsagePercent.value, 50);
  assert.equal(item.metrics.ioWaitPercent.value, 0); assert.equal(item.volumes.length, 2);
  assert.equal(item.volumes.find(volume => volume.name === "/").availableBytes.value, 500);
  assert.ok(!JSON.stringify(item).includes("docker")); assert.ok(!JSON.stringify(item).includes("itemid"));
  const requests = f.calls.filter(call => call.method === "item.get" && call.params.hostids?.includes("77"));
  assert.equal(requests.length, 1);
  const raw = f.items.filter(item => item.lastvalue.startsWith("DO_NOT_")).map(item => item.itemid);
  assert.ok(f.calls.filter(call => call.params.itemids).every(call => call.params.itemids.every(id => !raw.includes(id))));
  f.host.host = "renamed-without-changing-tag";
  assert.equal(normalizeStorage(f.host, f.items, f.now).storageKey, item.storageKey);
});

test("in-scope Storage adds no second item metadata/value requests", async () => {
  const f = storageFixture();
  f.hosts[1].tags = [{ tag: "role", value: "storage" }]; f.host.tags = [];
  const result = await collectSnapshots({ rpc: f.rpc, scope: f.scope, configs: [], now: f.now });
  assert.equal(result.entries["pulse:inventory:storages"].items[0].hostid, "2");
  assert.equal(f.calls.filter(call => call.method === "item.get").length, 2);
});
test("weighted capacity requires complete independent volumes and preserves real free space", () => {
  const f = storageFixture(), storage = normalizeStorage(f.host, f.items, f.now), volumes = storage.volumes;
  const root = storageCapacity(volumes); assert.equal(root.usagePercent.value, 40); assert.equal(root.availableBytes.value, 500);
  const preference = { filesystemKeys: volumes.map(volume => volume.key), independentVolumesConfirmed: true };
  const all = storageCapacity(volumes, preference); assert.equal(all.usagePercent.value, 9400 / 11000 * 100);
  assert.equal(all.availableBytes.value, 1300);
  for (const broken of [[], volumes.map((volume, index) => index ? { ...volume, metrics: {} } : volume), volumes.map(volume => ({ ...volume, metrics: { ...volume.metrics, diskTotalBytes: { ...volume.metrics.diskTotalBytes, value: 0 } } }))]) assert.equal(storageCapacity(broken, preference).usagePercent, undefined);
  assert.equal(storageCapacity(volumes, { ...preference, independentVolumesConfirmed: false }).coverage, "incomplete");
  assert.equal(storageCapacity(volumes, { ...preference, filesystemKeys: [volumes[0].key, volumes[0].key] }).usagePercent, undefined);
  assert.equal(storagePreferencesSchema.safeParse(preference).success, true);
  assert.equal(storageWriteSchema.safeParse({ ...preference, expectedRevision: 0, hostid: "77" }).success, false);
});
test("duplicate logical volume sources have deterministic precedence; ambiguous direct items stay missing", () => {
  const f = storageFixture(); f.item("vfs.fs.dependent.size[/,used]", 999, "B");
  let source = normalizeStorage(f.host, f.items, f.now); assert.equal(storageCapacity(source.volumes).usedBytes.value, 400);
  f.item("vfs.fs.size[/,used]", 200, "B");
  source = normalizeStorage(f.host, f.items, f.now); assert.equal(storageCapacity(source.volumes).usagePercent, undefined);
});
test("isolated failure carries original evidence, sentinel limits and incomplete values never confirm removals", async () => {
  const f = storageFixture(), args = { rpc: f.rpc, hosts: [], items: [], knownHostIds: [], now: f.now };
  const previous = await collectStorage(args); assert.equal(previous.status, "ok");
  const failed = await collectStorage({ ...args, now: f.now + 30000, previous, rpc: async () => { throw new Error("PRIVATE_TOKEN"); } });
  assert.equal(failed.status, "failed"); assert.deepEqual(failed.items, previous.items); assert.equal(failed.lastSuccessfulAt, previous.lastSuccessfulAt); assert.ok(!JSON.stringify(failed).includes("PRIVATE"));
  assert.equal((await collectStorage({ ...args, rpc: async () => Array.from({ length: 101 }, () => f.host) })).error, "storage_inventory_too_large");
  assert.equal((await collectStorage({ ...args, rpc: async (method, params) => method === "item.get" && params.itemids ? [] : f.rpc(method, params) })).status, "failed");
  f.host.tags = [];
  const removed = await collectStorage({ ...args, knownHostIds: [f.host.hostid] }); assert.equal(removed.absent[0].resolution, "tag_missing");
  f.hosts.splice(f.hosts.indexOf(f.host), 1);
  assert.equal((await collectStorage({ ...args, knownHostIds: ["77"] })).absent[0].resolution, "host_missing");
});
function view() {
  const f = storageFixture(), source = normalizeStorage(f.host, f.items, f.now);
  const { hostid, name, ...rest } = source; void hostid;
  return { ...rest, displayName: name, configId: randomUUID(), revision: 1, description: "private note", critical: false, displayOrder: 0, dashboardEnabled: false, presentationStatus: "ready", resolution: "resolved", stale: false, capacity: storageCapacity(source.volumes), selectedInterface: source.interfaces[0] };
}
test("all Storage surfaces use the same availability rules and public data drops private names", () => {
  const item = view(), now = Date.now();
  assert.equal(storageStatus(item, now).label, "Disponível");
  assert.equal(storageStatus({ ...item, stale: true }, now).label, "Desatualizado");
  assert.equal(storageStatus({ ...item, availability: "unreachable" }, now).label, "Indisponível");
  assert.equal(storageStatus({ ...item, resolution: "monitoring_disabled" }, now).tone, "unknown");
  const output = publicStorage(item); assert.equal(output.description, null); assert.equal(output.interfaces.length, 0); assert.equal(output.volumes[0].name, "Volume 1"); assert.equal(output.selectedInterface.name, "Interface monitorada");
  assert.ok(!JSON.stringify(output).includes("eth0")); assert.ok(!JSON.stringify(output).includes('"name":"/"'));
  const options = effectiveOptions({ type: "highlighted_resources" });
  assert.equal(buildDefaultAvailabilityCards([], [], [], [], options, [item]).length, 0);
  assert.equal(buildCustomAvailabilityCards([`storage:${item.configId}`], { resources: new Map(), probes: new Map(), vps: new Map(), signalCards: new Map(), storages: new Map([[item.configId, item]]) })[0].item, item);
});
test("Storage layout packs by UUID with ordered widths, unique top pair and independent duplicate blocks", () => {
  const block = (type, width = "wide") => ({ id: randomUUID(), type, width, enabled: true, options: type === "storage_summary" ? { storageConfigId: randomUUID(), visibleRows: 3 } : effectiveOptions({ type }) });
  const blocks = [block("summary", "full"), block("highlighted_resources", "full"), block("problems"), block("asgard_summary"), block("storage_summary"), block("storage_summary")];
  const plan = storageLayout(blocks, true);
  assert.equal(plan.rows[0].paired, true); assert.equal(plan.rows.length, 3); assert.equal(plan.summaries.length, 1);
  const ids = plan.rows.flatMap(row => row.blocks.map(item => item.block.id)); assert.equal(new Set(ids).size, 5);
  const duplicate = storageLayout([...blocks, block("problems")], true); assert.equal(duplicate.rows.some(row => row.paired), false);
  for (const row of duplicate.rows) assert.ok(row.blocks.reduce((total, item) => total + item.span, 0) <= 12);
  assert.equal(playableScreens({ screens: [{ enabled: true, blocks: [block("storage_summary")] }] }).length, 1);
});

test("standalone availability rows keep natural height while mixed and split rows share panel height", () => {
  const block = (type, width = "wide") => ({ id: randomUUID(), type, width, enabled: true, options: type === "storage_summary" ? { storageConfigId: randomUUID(), visibleRows: 3 } : effectiveOptions({ type }) });
  const standalone = storageLayout([block("highlighted_resources", "full"), block("asgard_summary"), block("storage_summary")], false);
  assert.deepEqual(standalone.rows.map(row => row.contentSized), [true, false]);
  const mixed = storageLayout([block("highlighted_resources"), block("asgard_summary"), block("storage_summary", "full")], false);
  assert.equal(mixed.rows[0].contentSized, false);
  const paired = storageLayout([block("highlighted_resources", "full"), block("problems"), block("storage_summary")], true);
  assert.equal(paired.rows[0].paired, true); assert.equal(paired.rows[0].contentSized, false);
  const repeated = storageLayout([block("highlighted_resources"), block("highlighted_resources"), block("storage_summary", "full")], false);
  assert.equal(repeated.rows[0].blocks.length, 2); assert.equal(repeated.rows[0].contentSized, true);
});
