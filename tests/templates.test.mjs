import { test } from "node:test";
import assert from "node:assert/strict";
import { opaqueReference } from "../lib/server/zabbix/observations.ts";
import { isVmTemplate, operationalHost, operationalProblems, virtualizationType } from "../lib/server/monitoring/virtual-machines.ts";
import { templateWriteSchema } from "../lib/config/templates.ts";

const machine = (name, id = "101", hostKey = "ASGARD", type = "qemu") => ({ name, vmId: id, parentHostKey: hostKey, vmKey: opaqueReference("vm", hostKey, type + "/" + id), state: "stopped", metrics: {}, linuxHostKey: null, evidence: { source: "zabbix", observedAt: null, basis: "unknown" } });
const alert = (vm, description, type = "vm") => ({ id: "event-" + vm.vmKey, resource: { type, hostKey: vm.parentHostKey, reference: vm.vmKey }, description, severity: 2, visualState: "warning", startedAt: "2026-10-03T00:00:00Z" });
test("explicit template naming rule filters only VM lists, preserving all host capacities and source inventory", () => {
  const template = machine("tpl-worker-ubuntu-24"), vm = machine("vm-tpl-operation", "102");
  const host = { hostKey: "ASGARD", vms: [template, vm], metrics: { memoryTotalBytes: { value: 1000 } }, storages: [{ name: "total", metrics: { diskUsedBytes: { value: 50 } } }] };
  const before = structuredClone(host), visible = operationalHost(host);
  assert.equal(isVmTemplate(template), true); assert.equal(isVmTemplate(vm), false);
  assert.deepEqual(visible.vms, [vm]); assert.deepEqual(visible.metrics, before.metrics); assert.deepEqual(visible.storages, before.storages); assert.deepEqual(host, before);
});
test("virtualization identity is verified against the collector key, never guessed from VM names", () => {
  assert.equal(virtualizationType(machine("tpl-lxc-in-name")), "qemu");
  assert.equal(virtualizationType(machine("tpl-qemu-in-name", "101", "ASGARD", "lxc")), "lxc");
  assert.equal(virtualizationType({ ...machine("tpl-unknown"), vmKey: "unverified" }), null);
  assert.equal(virtualizationType({ ...machine("tpl-other"), parentHostKey: "other" }), null);
});
test("template problems require a scoped resource association and unrecognized host alerts remain visible", () => {
  const template = machine("tpl-worker"), vm = machine("vm-operation", "101", "OTHER");
  const problems = [alert(template, "Template stopped"), alert(vm, "VM stopped"), alert(template, "Host alert mentions tpl-worker", "host")];
  const result = operationalProblems(problems, [{ hostKey: "ASGARD", vms: [template] }, { hostKey: "OTHER", vms: [vm] }]);
  assert.equal(result.length, 2); assert.equal(result[0].resource.hostKey, "OTHER"); assert.equal(result[1].description, problems[2].description);
  assert.deepEqual(operationalProblems(problems, []), problems);
});
test("humanized alerts preserve original descriptions and require an exact verified machine prefix", () => {
  const vm = machine("vm-squad-ia-07", "9002007"), hosts = [{ hostKey: "ASGARD", vms: [vm] }];
  for (const suffix of [": Not running", " high memory usage (over 90% use)"]) {
    const original = `Proxmox VE: VM [ASGARD/${vm.name} (qemu/${vm.vmId})]${suffix}`;
    const [result] = operationalProblems([alert(vm, original)], hosts);
    assert.equal(result.description, original); assert.equal(result.displayDescription, `${vm.name} (${vm.vmId}) · ${suffix.replace(/^:\s*|^\s+/, "")}`);
  }
  for (const original of ["Something else tpl-other", "Proxmox VE: VM [ASGARD/wrong-name (qemu/9002007)]: Not running", `Proxmox VE: VM [ASGARD/${vm.name} (lxc/9002007)]: Not running`, `Proxmox VE: VM [ASGARD/${vm.name} (qemu/9002007)]extra`]) {
    const [result] = operationalProblems([alert(vm, original)], hosts); assert.equal(result.displayDescription, undefined); assert.equal(result.description, original);
  }
});
test("template metadata writes accept only human choices with bounded labels and explicit revision", () => {
  const valid = { expectedRevision: 0, displayName: " Worker Ubuntu 24.04 ", roleOverride: null };
  assert.equal(templateWriteSchema.parse(valid).displayName, "Worker Ubuntu 24.04");
  for (const value of [{ ...valid, cpu: 4 }, { ...valid, templateId: "12" }, { ...valid, roleOverride: "master" }, { ...valid, displayName: "" }, { ...valid, displayName: "bad\nlabel" }, { ...valid, expectedRevision: -1 }]) assert.equal(templateWriteSchema.safeParse(value).success, false);
});
