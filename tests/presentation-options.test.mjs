import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { initialPresentation, presentationDocumentSchema, effectiveOptions, blockTypes, presentationWriteSchema } from "../lib/config/presentation.ts";
import { sortInventory, selectVms, selectProblems, selectHighlights } from "../lib/dashboard/block-options.ts";
import { isBalancedComposition } from "../lib/dashboard/layout.ts";

test("version 2 has type-specific defaults, strict options and six enabled blocks; version 1 stays readable", () => {
  const document = initialPresentation(randomUUID), screen = document.screens[0];
  assert.equal(document.schemaVersion, 2); assert.ok(presentationDocumentSchema.safeParse(document).success);
  for (const type of blockTypes) {
    screen.blocks = [{ id: randomUUID(), type, enabled: true, width: "full", options: effectiveOptions({ type }), ...(type === "resource_card" ? { resourceConfigId: randomUUID() } : {}) }];
    assert.ok(presentationDocumentSchema.safeParse(document).success, type);
    screen.blocks[0].options.unknownField = true;
    assert.equal(presentationDocumentSchema.safeParse(document).success, false, type);
  }
  screen.blocks = Array.from({ length: 7 }, () => ({ id: randomUUID(), type: "summary", width: "full", enabled: true, options: effectiveOptions({ type: "summary" }) }));
  assert.equal(presentationDocumentSchema.safeParse(document).success, false);
  screen.blocks[6].enabled = false; assert.ok(presentationDocumentSchema.safeParse(document).success);
  document.schemaVersion = 1; screen.blocks.forEach(block => { delete block.options; block.enabled = true; });
  assert.ok(presentationDocumentSchema.safeParse(document).success);
  const { revision, ...settings } = document; assert.ok(presentationWriteSchema.safeParse({ expectedRevision: revision, settings }).success);
  assert.deepEqual(effectiveOptions(screen.blocks[0]).indicators, ["hosts", "containers_running", "containers_stopped", "problems"]);
  assert.equal(screen.blocks[0].options, undefined);
});
test("invalid ranges, duplicate and empty filters and options from another type are rejected", () => {
  for (const [type, options] of [["summary", { indicators: [] }], ["summary", { indicators: ["hosts", "hosts"] }], ["asgard_summary", { states: [] }], ["asgard_summary", { sortBy: "health" }], ["problems", { severities: [6] }], ["problems", { severities: [0,0] }], ["host_inventory", { visibleRows: 2 }], ["host_inventory", { visibleRows: 11 }], ["highlighted_resources", { visibleRows: 4 }], ["container_inventory", { hostKeys: ["a", "a"] }], ["container_inventory", { hostKeys: ["../a"] }]]) {
    assert.throws(() => effectiveOptions({ type, options }), `${type}: ${JSON.stringify(options)}`);
  }
});
const now = Date.parse("2026-10-03T12:00:00Z"), evidence = { observedAt: new Date(now - 1000).toISOString(), validUntil: new Date(now + 1000).toISOString() };
const metric = (value, extra = {}) => ({ value, quality: "fresh", unit: "percent", ...evidence, ...extra });
const vm = (name, value, extra = {}) => ({ name, vmKey: name, parentHostKey: "ASGARD", state: "running", evidence, metrics: { cpuUsagePercent: metric(value) }, ...extra });
test("numeric sorts preserve zero and above 100, put expired/stale/bytes/missing last in both directions", () => {
  const items = [vm("C", 150), vm("A", 0), vm("B", 20), vm("Z", null, { metrics: {} }), vm("U", 4, { metrics: { cpuUsagePercent: metric(4, { quality: "stale" }) } }), vm("V", 4, { metrics: { cpuUsagePercent: metric(4, { validUntil: new Date(now - 1).toISOString() }) } }), vm("W", 4, { metrics: { cpuUsagePercent: metric(4, { unit: "bytes" }) } })];
  for (const direction of ["asc", "desc"]) {
    const names = sortInventory(items, { sortBy: "cpu", sortDirection: direction }, false, now).map(item => item.name);
    assert.deepEqual(names.slice(0,3), direction === "asc" ? ["A", "B", "C"] : ["C", "B", "A"]); assert.deepEqual(names.slice(3), ["U", "V", "W", "Z"]);
  }
  assert.deepEqual(items.map(item => item.name), ["C", "A", "B", "Z", "U", "V", "W"]);
});
test("state/health ordering keeps unknown last and filtered VMs retain all rows", () => {
  const items = [vm("Unknown", 0, { state: "unknown" }), vm("Stopped", 0, { state: "stopped" }), vm("Paused", 0, { state: "paused" }), vm("Running", 0)];
  assert.deepEqual(sortInventory(items, { sortBy: "state", sortDirection: "desc" }, false, now).map(item => item.name), ["Stopped", "Paused", "Running", "Unknown"]);
  const options = effectiveOptions({ type: "asgard_summary", options: { states: ["running"], visibleRows: 3 } });
  assert.equal(selectVms(Array.from({ length: 20 }, (_, i) => vm(String(i), i)), options, false, now).length, 20);
  assert.equal(selectVms(items, options, true, now).length, 0);
  const containers = ["unknown", "healthy", "unhealthy", "not_configured", "starting"].map(health => ({ name: health, reference: health, hostKey: "h", health, status: "running", metrics: {}, evidence }));
  assert.deepEqual(sortInventory(containers, { sortBy: "health", sortDirection: "asc" }, false, now).map(item => item.health), ["unhealthy", "starting", "healthy", "not_configured", "unknown"]);
});
test("problem filters use original severity and recent evidence; configured highlights respect order and stable ID", () => {
  const problems = [{ id: "1", severity: 5, startedAt: "2026-10-02" }, { id: "2", severity: 2, startedAt: "2026-10-03" }, { id: "3", severity: 5, startedAt: "2026-10-03" }];
  assert.deepEqual(selectProblems(problems, effectiveOptions({ type: "problems" })).map(item => item.id), ["3", "1", "2"]);
  assert.deepEqual(selectProblems(problems, effectiveOptions({ type: "problems", options: { severities: [2] } })).map(item => item.id), ["2"]);
  const resources = [3, 1, 2].map(id => ({ id: String(id), config: { critical: id !== 1, displayOrder: 0, displayName: "Same" } }));
  assert.deepEqual(selectHighlights(resources, effectiveOptions({ type: "highlighted_resources", options: { criticalOnly: true } })).map(item => item.id), ["2", "3"]);
});
test("only default options use the compact balanced preset; custom row windows may scroll", () => {
  const blocks = initialPresentation(randomUUID).screens[0].blocks;
  assert.equal(isBalancedComposition(blocks), true); blocks[2].options.visibleRows = 10; assert.equal(isBalancedComposition(blocks), false);
});
