import test from "node:test";
import assert from "node:assert/strict";
import { zabbixFixture, addClusterStatusHeartbeat } from "./fixtures/zabbix.mjs";
import { observationContext } from "../lib/server/zabbix/observations.ts";
import { normalizeInventory } from "../lib/server/zabbix/normalize.ts";
import { freshness } from "../lib/server/monitoring/inventory.ts";

const now = Date.parse("2026-10-04T00:33:54Z");
const host = (f, at = f.now) => normalizeInventory(f.hosts.slice(0, 2), f.items, "ASGARD", f.scope.scope.vmLinks, at).hosts[0];

test("ASGARD remains available across ten-minute heartbeats and a delayed confirmation", () => {
  const f = zabbixFixture(now), { online } = addClusterStatusHeartbeat(f);
  const start = Number(online.lastclock) * 1000;
  for (let elapsed = 0; elapsed <= 1800; elapsed += 20) {
    const received = elapsed >= 1200 ? 1200 : elapsed >= 900 ? 600 : 0;
    online.lastclock = String((start + received * 1000) / 1000);
    const current = host(f, start + elapsed * 1000);
    assert.equal(current.availability, "reachable", `elapsed ${elapsed}s`);
    assert.equal(current.evidence.observedAt, new Date(Number(online.lastclock) * 1000).toISOString());
    assert.equal(freshness(current, false, start + elapsed * 1000).availability, "reachable");
  }
});

test("ASGARD expires after the heartbeat plus tolerance, never becomes offline just from silence, and recovers", () => {
  const f = zabbixFixture(now), { online } = addClusterStatusHeartbeat(f);
  const start = Number(online.lastclock) * 1000, deadline = start + 990000;
  const initial = host(f);
  assert.equal(initial.evidence.validUntil, new Date(deadline).toISOString());
  assert.equal(host(f, deadline).availability, "reachable");
  assert.equal(host(f, deadline + 1).availability, "unknown");
  assert.equal(freshness(initial, false, deadline + 1).availability, "unknown");
  assert.equal(host(f, deadline + 86400000).availability, "unknown");
  online.lastclock = String((deadline + 60000) / 1000);
  assert.equal(host(f, deadline + 60000).availability, "reachable");
});

test("fresh explicit offline evidence is immediate, without waiting for the tolerance", () => {
  const f = zabbixFixture(now), { online } = addClusterStatusHeartbeat(f);
  online.lastvalue = "0"; online.lastclock = String(now / 1000);
  assert.equal(host(f).availability, "unreachable");
  online.lastvalue = "1";
  assert.equal(host(f).availability, "reachable");
});

test("unthrottled Agent availability tolerates late polls but still expires", () => {
  const f = zabbixFixture(now), item = f.items.find(i => i.key_ === "zabbix[host,agent,available]");
  item.lastclock = String(now / 1000);
  assert.equal(observationContext(f.items, now + 180000).evidence(item).quality, "fresh");
  assert.equal(observationContext(f.items, now + 210001).evidence(item).quality, "stale");
});

test("old, future, disabled or unsupported evidence is not renewed by fresh unrelated metrics", () => {
  for (const scenario of ["old", "future", "disabled", "unsupported", "master_disabled", "master_unsupported", "master_lost", "master_missing", "master_foreign", "invalid_delay", "invalid_heartbeat", "cycle"]) {
    const f = zabbixFixture(now), { online, master } = addClusterStatusHeartbeat(f);
    if (scenario === "old") online.lastclock = String(now / 1000 - 1000);
    if (scenario === "future") online.lastclock = String(now / 1000 + 120);
    if (scenario === "disabled") online.status = "1";
    if (scenario === "unsupported") online.state = "1";
    if (scenario === "master_disabled") master.status = "1";
    if (scenario === "master_unsupported") master.state = "1";
    if (scenario === "master_lost") master.itemDiscovery = { status: "1" };
    if (scenario === "master_missing") f.items.splice(f.items.indexOf(master), 1);
    if (scenario === "master_foreign") master.hostid = "2";
    if (scenario === "invalid_delay") master.delay = "{$INTERVAL}";
    if (scenario === "invalid_heartbeat") online.preprocessing = [{ type: "20", params: "{$HEARTBEAT}" }];
    if (scenario === "cycle") master.master_itemid = online.itemid;
    assert.equal(host(f).availability, "unknown", scenario);
  }
});

test("a throttled sibling cannot extend the target beyond its own deadline or stretch history", () => {
  const f = zabbixFixture(now), { online, master } = addClusterStatusHeartbeat(f);
  f.items.push({ ...online, itemid: "998001", key_: "other.capacity", lastclock: String(now / 1000), preprocessing: [{ type: "20", params: "1d" }] });
  const evidence = observationContext(f.items, now).evidence(online);
  assert.equal(evidence.validUntil, new Date(Number(online.lastclock) * 1000 + 990000).toISOString());
  assert.equal(evidence.maxGapSeconds, 840, "history keeps its existing gap policy");
  assert.equal(host(f, now + 600000).availability, "unknown");
  master.state = "1";
  assert.equal(host(f).availability, "unknown");
});
