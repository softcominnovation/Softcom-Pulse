import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { effectiveOptions, initialPresentation, presentationWriteSchema, withReadingPlayback } from "../lib/config/presentation.ts";
import { dashboardGridRows } from "../lib/dashboard/layout.ts";

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
  const flex = "minmax(200px, 1fr)";
  assert.equal(dashboardGridRows(blocks, false), `max-content max-content ${flex}`);
  assert.equal(dashboardGridRows(blocks, true), `max-content ${flex}`);
  blocks[0].enabled = false;
  assert.equal(dashboardGridRows(blocks, false), `max-content ${flex}`);
  assert.equal(dashboardGridRows(blocks, true), flex);
  const extra = { ...structuredClone(blocks[0]), id: randomUUID(), enabled: true };
  blocks.push(extra, { ...extra, id: randomUUID() });
  assert.equal(dashboardGridRows(blocks, true), `max-content max-content ${flex}`);
  blocks[1].enabled = false;
  assert.equal(dashboardGridRows(blocks.slice(0, 4), false), flex);
});
