import test from "node:test";
import assert from "node:assert/strict";
import { recordZabbixNotifications } from "../lib/server/notifications/zabbix.ts";
import { createCycle } from "../collector/worker.ts";

const time = Date.now(), evidence = { observedAt: new Date(time - 1000).toISOString(), validUntil: new Date(time + 60000).toISOString() };
const resource = { ref: "resource:one", id: "one", kind: "resource", identity: { resourceType: "host" }, epoch: "epoch", enabled: true, critical: true };
const storage = { ...resource, ref: "storage:two", id: "two", kind: "storage", identity: { hostId: "2" } };
function fixture() {
  return { targets: [resource, storage], configs: [{ id: "one", resourceType: "host", zabbixHostKey: "host-one" }],
    inventory: { hosts: [{ hostKey: "host-one", availability: "reachable", evidence }], containers: [], itemResources: new Map() },
    hosts: [{ hostid: "1", host: "host-one", status: "0" }],
    problems: [{ eventid: "10", objectid: "100", severity: "4", clock: String(Math.floor(time / 1000)) }],
    triggers: [{ triggerid: "100", status: "0", hosts: [{ host: "host-one" }], items: [] }],
    storage: { status: "ok", items: [{ hostid: "2", technicalName: "host-two", monitoringEnabled: true, availability: "reachable", evidence }], absent: [] },
    checkedAt: time, rpc: async () => { throw new Error("fixture upstream failure"); } };
}
test("failed supplemental Storage problems preserve primary host evidence and do not resolve Storage incidents", async () => {
  const input = fixture(), records = [];
  await recordZabbixNotifications(input, { prior: async () => [{ target_ref: storage.ref, condition_key: "problem:20:200" }], record: async (...args) => records.push(args) });
  assert.equal(records[0][1].some(row => row.key === "problem:10:100"), true);
  assert.equal(records[0][2].includes("problems"), true);
  assert.deepEqual(records[1][1].map(row => row.key), ["availability"]);
  assert.equal(records[1][2].includes("problems"), false);
});
test("tag removal suppresses availability, incomplete absence stays unknown, disabled trigger cancels", async () => {
  const input = fixture(), records = [];
  input.storage.items = []; input.storage.absent = [{ hostid: "2", resolution: "tag_missing" }];
  input.problems = []; input.rpc = async () => [{ triggerid: "100", status: "1", hosts: [{ host: "host-one" }], items: [] }]; input.triggers = [];
  await recordZabbixNotifications(input, { prior: async () => [{ target_ref: resource.ref, condition_key: "problem:10:100" }], record: async (...args) => records.push(args) });
  assert.equal(records[0][1].find(row => row.key === "problem:10:100").observation.state, "suppressed");
  assert.equal(records[1][1][0].observation.state, "suppressed");
  records.length = 0; input.storage.absent = []; input.storage.status = "error";
  await recordZabbixNotifications(input, { prior: async () => [], record: async (...args) => records.push(args) });
  assert.equal(records[1][1][0].observation.state, "unknown");
});
test("expired budget skips notification work and hook failure never invalidates the published snapshot", async () => {
  const input = fixture(); input.signal = AbortSignal.abort();
  await recordZabbixNotifications(input, { prior: async () => assert.fail("expired work"), record: async () => assert.fail("expired write") });
  const calls = [];
  const cycle = createCycle({ collect: async () => ({ entries: {}, notify: async () => { calls.push("notification"); throw new Error("test"); } }), publish: async () => calls.push("publish"), fail: async () => calls.push("failed") });
  assert.equal(await cycle(), true); assert.deepEqual(calls, ["publish", "notification"]);
});
