import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { effectiveOptions, initialPresentation, presentationWriteSchema, withReadingPlayback } from "../lib/config/presentation.ts";
import { dashboardGridRows, overviewSplitRows, overviewSplitTracks, usesRowComposition, isAvailabilityDivided } from "../lib/dashboard/layout.ts";

test("KPI font scale defaults locally, accepts only supported percentages and reading saves preserve composition", () => {
  const legacy = { indicators: ["hosts"] };
  assert.deepEqual(effectiveOptions({ type: "summary", options: legacy }), { indicators: ["hosts"], fontScalePercent: 100 });
  assert.deepEqual(legacy, { indicators: ["hosts"] });
  const { revision, ...settings } = initialPresentation(randomUUID);
  for (const fontScalePercent of [100, 110, 125, 150]) {
    settings.screens[0].blocks[0].options.fontScalePercent = fontScalePercent;
    assert.equal(presentationWriteSchema.safeParse({ expectedRevision: revision, settings }).success, true);
  }
  for (const fontScalePercent of [0, 99, 120, 151, 110.5, "150", null]) {
    settings.screens[0].blocks[0].options.fontScalePercent = fontScalePercent;
    assert.equal(presentationWriteSchema.safeParse({ expectedRevision: revision, settings }).success, false, String(fontScalePercent));
  }
  settings.screens[0].blocks[0].options.fontScalePercent = 100;
  const draft = structuredClone(settings); draft.screens[0].blocks[0].options.fontScalePercent = 150;
  assert.equal(withReadingPlayback(settings, draft).screens[0].blocks[0].options.fontScalePercent, 100);
  assert.equal(draft.screens[0].blocks[0].options.fontScalePercent, 150);
});

test("dashboard row tracks follow enabled content rather than reserving a missing KPI row", () => {
  const blocks = initialPresentation(randomUUID).screens[0].blocks;
  const flex = "minmax(calc(210px * var(--dashboard-scale, 1)), 1fr)";
  const splitFlex = "minmax(min-content, 1fr)";
  assert.equal(dashboardGridRows(blocks, false), `max-content max-content ${flex}`);
  assert.equal(dashboardGridRows(blocks, true), `max-content ${splitFlex}`);
  blocks[0].enabled = false;
  assert.equal(dashboardGridRows(blocks, false), `max-content ${flex}`);
  assert.equal(dashboardGridRows(blocks, true), splitFlex);
  const extra = { ...structuredClone(blocks[0]), id: randomUUID(), enabled: true };
  blocks.push(extra, { ...extra, id: randomUUID() });
  assert.equal(dashboardGridRows(blocks, true), `max-content max-content ${splitFlex}`);
  blocks[1].enabled = false;
  assert.equal(dashboardGridRows(blocks.slice(0, 4), false), flex);
});

test("split tracks include only enabled rows and keep repeated panels out of named areas", () => {
  const blocks = initialPresentation(randomUUID).screens[0].blocks;
  blocks.push({ id: randomUUID(), type: "signal_flow", width: "wide", enabled: true, options: effectiveOptions({ type: "signal_flow" }) });
  const flex = "minmax(calc(210px * var(--dashboard-scale, 1)), 1fr)";
  const tracks = overviewSplitTracks(blocks);
  assert.equal(tracks.areas, '"avail side" "asgard signal"');
  assert.equal(tracks.rows, `max-content ${flex}`);
  blocks.find(block => block.type === "asgard_summary").enabled = false;
  blocks.find(block => block.type === "signal_flow").enabled = false;
  assert.equal(overviewSplitTracks(blocks).areas, '"avail side"');
  assert.equal(overviewSplitTracks(blocks).rows, "minmax(min-content, 1fr)");
  blocks.find(block => block.type === "problems").enabled = false;
  assert.equal(overviewSplitTracks(blocks).areas, '"avail avail"');
  assert.equal(isAvailabilityDivided(blocks[1], blocks, true), false);
  const duplicate = { ...structuredClone(blocks[1]), id: randomUUID() };
  assert.equal(usesRowComposition(blocks, true), false);
  assert.equal(usesRowComposition([...blocks, duplicate], true), true);
  duplicate.enabled = false;
  assert.equal(usesRowComposition([...blocks, duplicate], true), false);
  for (const block of blocks) block.enabled = ["asgard_summary", "signal_flow"].includes(block.type);
  assert.equal(overviewSplitTracks(blocks).areas, '"asgard side"');
  assert.equal(overviewSplitRows(blocks).length, 1);
  assert.equal(overviewSplitTracks(blocks).rows, flex);
});
