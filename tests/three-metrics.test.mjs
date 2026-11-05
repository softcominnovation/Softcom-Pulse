import test from "node:test";
import assert from "node:assert/strict";
import { cardMetricsSchema, cardMetricPresentation, cardMetricOrder, mergeCardMetricPresentation } from "../lib/config/agent-monitoring.ts";
import { storagePreferencesSchema, storageWriteSchema } from "../lib/config/storages.ts";
import { standaloneVpsWriteSchema, standaloneVpsPatchSchema } from "../lib/config/standalone-vps.ts";
import { availabilityRowLimit } from "../lib/dashboard/availability-sizing.ts";
import { vpsCardValues, vpsCardReadingMaxAgeMs } from "../lib/vps/labels.ts";
import { monitorFixture } from "./fixtures/monitor-compat.mjs";
import { renderCompatibleContent } from "../lib/server/monitor-compat/render.ts";

const trio = ["cpu", "memory", "disk"];
test("explicit trio has one canonical persisted order, visual disk first and coherent legacy flags", () => {
  for (const metrics of [["cpu", "memory"], ["cpu", "disk"], ["disk", "memory"], trio]) {
    assert.deepEqual(cardMetricsSchema.parse(metrics), metrics);
    assert.deepEqual(cardMetricOrder(metrics), metrics.length === 3 ? ["disk", "cpu", "memory"] : metrics);
    const presentation = cardMetricPresentation(metrics);
    assert.deepEqual(presentation.cardMetrics, metrics);
    assert.equal(presentation.showDisk, metrics.includes("disk"));
  }
  for (const metrics of [["disk", "cpu", "memory"], ["cpu", "cpu", "disk"], ["cpu"], ["cpu", "ram"], []]) assert.equal(cardMetricsSchema.safeParse(metrics).success, false);
  const current = { ...cardMetricPresentation(trio), metricsSource: "agent" };
  assert.deepEqual(mergeCardMetricPresentation(current, { showNetwork: true }).cardMetrics, trio);
  assert.deepEqual(mergeCardMetricPresentation(cardMetricPresentation(["disk", "memory"]), { cardMetrics: trio }), cardMetricPresentation(trio));
});

test("Storage and VPS keep defaults, distinguish omitted preferences and allow explicit return to strip", () => {
  assert.deepEqual(storagePreferencesSchema.parse({}).cardMetrics, ["cpu", "disk"]);
  assert.equal(storageWriteSchema.parse({ expectedRevision: 0 }).cardMetrics, undefined);
  assert.deepEqual(storageWriteSchema.parse({ expectedRevision: 1, cardMetrics: trio }).cardMetrics, trio);
  assert.equal(standaloneVpsWriteSchema.parse({ name: "VPS", ip: "10.1.2.3" }).cardMetrics, undefined);
  assert.equal(standaloneVpsPatchSchema.parse({ expectedRevision: 1 }).cardMetrics, undefined);
  assert.equal(standaloneVpsPatchSchema.parse({ expectedRevision: 1, cardMetrics: null }).cardMetrics, null);
  assert.deepEqual(standaloneVpsPatchSchema.parse({ expectedRevision: 1, cardMetrics: trio }).cardMetrics, trio);
});

test("trio respects the configured size and manual row priority without rewriting preferences", () => {
  const model = monitorFixture(), cards = model.overview.data.blocks.find(block => block.type === "highlighted_resources").data.cards;
  const original = structuredClone(cards);
  for (const family of ["resource", "storage", "standalone_vps", "signal_service"]) {
    const card = structuredClone(cards.find(card => card.kind === family));
    assert.ok(card, family);
    if (family === "resource") card.item.config.presentation.cardMetrics = trio;
    else card.item.cardMetrics = trio;
    model.overview.data.blocks.find(block => block.type === "highlighted_resources").data.cards = [card];
    const block = model.screen.blocks.find(block => block.type === "highlighted_resources");
    for (const size of ["compact", "expanded"]) {
      Object.assign(block.options, { cardSize: size, rowMode: "manual", visibleRows: 1 });
      const html = renderCompatibleContent(model);
      assert.match(html, new RegExp('data-card-size="' + size + '"'));
      assert.match(html, /data-card-rows="1"/);
      assert.equal(block.options.cardSize, size);
      assert.equal(availabilityRowLimit(size, 1, true, true, "manual"), 1);
    }
  }
  assert.deepEqual(cards, original);
});

test("VPS metric mode never presents paused, failed, absent or expired evidence as current", () => {
  const now = Date.now(), model = monitorFixture();
  const card = model.overview.data.blocks.find(block => block.type === "highlighted_resources").data.cards.find(card => card.kind === "standalone_vps").item;
  Object.assign(card, { enabled: true, monitorConfigured: true, monitorPaused: false, monitorState: "up", checkedAt: new Date(now).toISOString(), cpuPercent: 0, memoryPercent: 42, diskPercent: 71 });
  assert.deepEqual(vpsCardValues(card, now), { cpu: 0, memory: 42, disk: 71 });
  for (const changes of [{ monitorPaused: true }, { monitorState: "down" }, { checkedAt: null }, { checkedAt: new Date(now - vpsCardReadingMaxAgeMs).toISOString() }, { monitorConfigured: false }]) assert.deepEqual(vpsCardValues({ ...card, ...changes }, now), { cpu: null, memory: null, disk: null });
});

test("classic first HTML renders all metric families with disk above CPU/RAM and retains strip families", () => {
  const model = monitorFixture({ split: true }), block = model.screen.blocks.find(block => block.type === "highlighted_resources");
  Object.assign(block.options, { cardSize: "compact", rowMode: "manual", visibleRows: 3 });
  const cards = model.overview.data.blocks.find(block => block.type === "highlighted_resources").data.cards;
  for (const card of cards) {
    if (card.kind === "resource") card.item.config.presentation.cardMetrics = trio;
    else if (["storage", "standalone_vps", "signal_service"].includes(card.kind)) card.item.cardMetrics = trio;
  }
  const html = renderCompatibleContent(model);
  assert.match(html, /data-card-size="compact"/); assert.match(html, /data-card-rows="3"/);
  assert.match(html, /max-height:468px/); assert.match(html, /data-measured-row="true"/);
  const grids = [...html.matchAll(/<span class="metric-grid mini-metrics" data-metric-count="3">([\s\S]*?)<\/span><\/span><span class="availability-footer">/g)];
  assert.equal(grids.length, 4);
  for (const grid of grids) { assert.ok(grid[1].indexOf("Disco") < grid[1].indexOf("CPU")); assert.ok(grid[1].indexOf("CPU") < grid[1].indexOf("RAM")); }
  assert.match(html, /Histórico de disponibilidade/);
  assert.equal(block.options.cardSize, "compact");
});
