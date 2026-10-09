import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { initialPresentation, presentationDocumentSchema, presentationWriteSchema } from "../lib/config/presentation.ts";

test("saved presentations without a reading scale default to 110 without changing composition or revision", () => {
  for (const version of [1, 2]) {
    const legacy = initialPresentation(randomUUID);
    legacy.schemaVersion = version;
    if (version === 1) legacy.screens.forEach(screen => screen.blocks.forEach(block => { delete block.options; }));
    delete legacy.displayScalePercent;
    const result = presentationDocumentSchema.parse(legacy);
    assert.equal(result.displayScalePercent, 110);
    const { displayScalePercent, ...unchanged } = result;
    void displayScalePercent;
    assert.deepEqual(unchanged, legacy);
    assert.equal(legacy.displayScalePercent, undefined);
  }
});

test("saved presentations without showStatusBanner default to hidden", () => {
  const legacy = initialPresentation(randomUUID);
  delete legacy.showStatusBanner;
  const result = presentationDocumentSchema.parse(legacy);
  assert.equal(result.showStatusBanner, false);
  assert.equal(legacy.showStatusBanner, undefined);
});

test("presentation writes accept only supported numeric reading scales", () => {
  const { revision, ...settings } = initialPresentation(randomUUID);
  for (const value of [100, 110, 120, 125]) {
    assert.equal(presentationWriteSchema.parse({ expectedRevision: revision, settings: { ...settings, displayScalePercent: value } }).settings.displayScalePercent, value);
  }
  for (const value of [0, 90, 111, 110.5, 150, "110", null, true]) {
    const result = presentationWriteSchema.safeParse({ expectedRevision: revision, settings: { ...settings, displayScalePercent: value } });
    assert.equal(result.success, false);
    assert.deepEqual(result.error.issues[0].path, ["settings", "displayScalePercent"]);
  }
});
