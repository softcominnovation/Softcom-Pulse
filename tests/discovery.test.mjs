import test from "node:test";
import assert from "node:assert/strict";
import { classifyAgentCandidates, discoveryEveryNCycles } from "../lib/server/zabbix/discovery.ts";
import { opaqueReference } from "../lib/server/zabbix/observations.ts";
import { createCycle } from "../collector/worker.ts";

test("discoveryEveryNCycles defaults to 3 and rejects invalid values", () => {
  assert.equal(discoveryEveryNCycles(undefined), 3);
  assert.equal(discoveryEveryNCycles(""), 3);
  assert.equal(discoveryEveryNCycles("2"), 2);
  assert.equal(discoveryEveryNCycles("0"), 3);
  assert.equal(discoveryEveryNCycles("99"), 3);
});

test("collector runs discovery only every N cycles", async () => {
  const previous = process.env.PULSE_DISCOVERY_EVERY_N_CYCLES;
  process.env.PULSE_DISCOVERY_EVERY_N_CYCLES = "3";
  try {
    const discovers = [];
    const run = createCycle({
      collect: async ({ discover } = {}) => { discovers.push(discover !== false); return { entries: { a: 1 }, discovery: discover === false ? null : { asgardHostKey: "ASGARD", candidates: [] } }; },
      publish: async () => {},
      publishDiscovery: async () => {},
      fail: async () => {},
    });
    assert.equal(await run(), true);
    assert.equal(await run(), true);
    assert.equal(await run(), true);
    assert.equal(await run(), true);
    assert.deepEqual(discovers, [true, false, false, true]);
  } finally {
    if (previous === undefined) delete process.env.PULSE_DISCOVERY_EVERY_N_CYCLES;
    else process.env.PULSE_DISCOVERY_EVERY_N_CYCLES = previous;
  }
});

const iface = (available, main = "1") => ({ type: "1", main, available });
const host = (key, { status = "0", available = "1", tags = [], name = key } = {}) => ({
  hostid: key, host: key, name, status, tags, hostgroups: [], interfaces: [iface(available)],
});
const vm = (name, vmId, linuxHostKey = null, type = "qemu") => ({
  vmKey: opaqueReference("vm", "ASGARD", `${type}/${vmId}`), vmId, name, parentHostKey: "ASGARD", state: "running",
  metrics: {}, linuxHostKey, evidence: { source: "zabbix", observedAt: null, basis: "item" },
});
const asgard = (vms) => ({
  hostKey: "ASGARD", name: "ASGARD", role: "hypervisor", availability: "reachable",
  metrics: {}, storages: [], filesystems: [], interfaces: [], vms, evidence: { source: "zabbix", observedAt: null, basis: "item" },
});

test("ready Agent outside scope becomes a candidate", () => {
  const result = classifyAgentCandidates({
    hosts: [host("ASGARD"), host("vm-new")],
    scopeHostKeys: ["ASGARD"],
    asgardHostKey: "ASGARD",
    inventoryHosts: [asgard([vm("vm-new", "9003001")])],
  });
  assert.equal(result.candidates.length, 1);
  assert.equal(result.candidates[0].hostKey, "vm-new");
  assert.equal(result.candidates[0].suggestedVm?.match, "exact_name");
  assert.equal(result.candidates[0].suggestedVm?.vmId, "qemu/9003001");
});

test("Agent already in scope is excluded", () => {
  const result = classifyAgentCandidates({
    hosts: [host("ASGARD"), host("vm-new")],
    scopeHostKeys: ["ASGARD", "vm-new"],
    asgardHostKey: "ASGARD",
    inventoryHosts: [asgard([])],
  });
  assert.deepEqual(result.candidates, []);
});

test("unavailable Agent interface is excluded", () => {
  const result = classifyAgentCandidates({
    hosts: [host("ASGARD"), host("vm-new", { available: "0" })],
    scopeHostKeys: ["ASGARD"],
    asgardHostKey: "ASGARD",
    inventoryHosts: [asgard([vm("vm-new", "1")])],
  });
  assert.deepEqual(result.candidates, []);
});

test("ASGARD is never listed as Agent candidate", () => {
  const result = classifyAgentCandidates({
    hosts: [host("ASGARD", { available: "1" })],
    scopeHostKeys: ["ASGARD"],
    asgardHostKey: "ASGARD",
    inventoryHosts: [asgard([])],
  });
  assert.deepEqual(result.candidates, []);
});

test("ambiguous exact name does not suggest a VM", () => {
  const result = classifyAgentCandidates({
    hosts: [host("ASGARD"), host("dup")],
    scopeHostKeys: ["ASGARD"],
    asgardHostKey: "ASGARD",
    inventoryHosts: [asgard([vm("dup", "1"), vm("dup", "2")])],
  });
  assert.equal(result.candidates[0].suggestedVm, null);
});

test("pulse tags win over exact name for suggestion", () => {
  const tagged = host("agent-a", {
    tags: [{ tag: "pulse.parent", value: "ASGARD" }, { tag: "pulse.vm", value: "qemu/42" }],
  });
  const result = classifyAgentCandidates({
    hosts: [host("ASGARD"), tagged],
    scopeHostKeys: ["ASGARD"],
    asgardHostKey: "ASGARD",
    inventoryHosts: [asgard([vm("agent-a", "99"), vm("other", "42")])],
  });
  assert.equal(result.candidates[0].suggestedVm?.match, "tags");
  assert.equal(result.candidates[0].suggestedVm?.vmId, "qemu/42");
});

test("VM that already has an Agent is not suggested", () => {
  const result = classifyAgentCandidates({
    hosts: [host("ASGARD"), host("vm-new")],
    scopeHostKeys: ["ASGARD"],
    asgardHostKey: "ASGARD",
    inventoryHosts: [asgard([vm("vm-new", "9003001", "already-linked")])],
  });
  assert.equal(result.candidates[0].suggestedVm, null);
});
