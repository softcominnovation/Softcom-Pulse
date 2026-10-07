import { test } from "node:test";
import assert from "node:assert/strict";
import { namesForInventory } from "../lib/monitoring/display-names.ts";
import { vmWriteSchema } from "../lib/config/vms.ts";
import { resourceInputSchema } from "../lib/config/resources.ts";
import { isVmTemplate } from "../lib/server/monitoring/virtual-machines.ts";

const vm = { vmKey: "vm-" + "1".repeat(32), vmId: "100", parentHostKey: "parent", name: "original", linuxHostKey: null, metrics: { cpuUsagePercent: { value: 12 } } };
const parent = { hostKey: "parent", name: "technical-parent", vms: [vm] };
const a = { reference: "a", hostKey: "agent", name: "app.1.abc", metrics: {} };
const b = { ...a, hostKey: "other", reference: "b" };
const config = (changes = {}) => ({ ...resourceInputSchema.parse({ resourceType: "docker_container", zabbixHostKey: "agent", selectorType: "name_prefix", selectorValue: "app.", displayName: "Application", ...changes }), id: "config" });

test("VM display names preserve technical identity, metrics and template classification", () => {
  const preference = { vmKey: vm.vmKey, vmId: vm.vmId, hostKey: vm.parentHostKey, displayName: "tpl Banco" };
  const names = namesForInventory([parent], [], [], [preference]);
  const output = names.host(parent).vms[0];
  assert.equal(output.displayName, "tpl Banco"); assert.equal(output.name, "original");
  assert.equal(output.metrics, vm.metrics); assert.equal(isVmTemplate(output), false);
  assert.equal(names.vm({ ...vm, parentHostKey: "other" }).displayName, "original");
  assert.equal(names.vm({ ...vm, vmKey: "different" }).displayName, "original");
  assert.equal(namesForInventory([parent], [], [], [{ ...preference, displayName: null }]).vm({ ...vm, name: "renamed-at-source" }).displayName, "renamed-at-source");
});
test("container aliases are independent from highlight and isolated by host and technical selector", () => {
  const names = namesForInventory([parent], [a, b], [config({ dashboardEnabled: false })], []);
  assert.equal(names.container(a).displayName, "Application"); assert.equal(names.container(b).displayName, b.name);
  assert.equal(names.container(a).name, a.name); assert.equal(names.container(a).resourceConfigurations[0].dashboardEnabled, false);
  assert.equal(namesForInventory([], [a], [config({ enabled: false })], []).container(a).displayName, a.name);
  const recreated = { ...a, reference: "new", name: "app.1.xyz" };
  assert.equal(namesForInventory([], [recreated], [config()], []).container(recreated).displayName, "Application");
  const ambiguous = namesForInventory([], [a, recreated], [config()], []);
  assert.equal(ambiguous.container(a).displayName, a.name);
  assert.equal(ambiguous.container(recreated).resourceConfigurations.length, 0);
});
test("overlapping aliases require agreement and retain every configuration for explicit editing", () => {
  const first = config(), second = { ...config({ selectorType: "exact_name", selectorValue: a.name, displayName: "Other" }), id: "second" };
  const conflict = namesForInventory([], [a], [first, second], []).container(a);
  assert.equal(conflict.displayName, a.name); assert.equal(conflict.nameConflict, true); assert.equal(conflict.resourceConfigurations.length, 2);
  second.displayName = first.displayName;
  const agreed = namesForInventory([], [a], [first, second], []).container(a);
  assert.equal(agreed.displayName, "Application"); assert.equal(agreed.nameConflict, false); assert.equal(agreed.resourceConfigurations.length, 2);
  second.enabled = false; second.displayName = "Other";
  assert.equal(namesForInventory([], [a], [first, second], []).container(a).displayName, "Application");
});
test("problem labels require proven references and fallback does not change evidence", () => {
  const names = namesForInventory([parent], [a], [config()], [], true);
  const original = { resource: { type: "docker_container", hostKey: "agent", reference: "a" }, description: "app.1.abc failed" };
  assert.equal(names.problem(original).resourceDisplayName, "Application");
  assert.equal(names.problem(original).description, original.description);
  assert.equal(names.problem({ ...original, resource: { ...original.resource, reference: "missing" } }).resourceDisplayName, undefined);
  assert.equal(names.container(a).presentationStatus, "unavailable"); assert.equal(names.container(a).metrics, a.metrics);
});
test("VM writes normalize empty names, enforce post-trim length and reject controls and identity writes", () => {
  assert.equal(vmWriteSchema.parse({ expectedRevision: 0, displayName: "   " }).displayName, null);
  assert.equal(vmWriteSchema.parse({ expectedRevision: 0, displayName: "  " + "a".repeat(120) + "  " }).displayName.length, 120);
  for (const displayName of ["a".repeat(121), "test\nname", "test\u0000name"]) assert.equal(vmWriteSchema.safeParse({ expectedRevision: 0, displayName }).success, false);
  assert.equal(vmWriteSchema.safeParse({ expectedRevision: 0, displayName: "Name", hostKey: "forged" }).success, false);
});
