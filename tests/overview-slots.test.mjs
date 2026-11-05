import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { initialPresentation, effectiveOptions, presentationDocumentSchema, withReadingPlayback } from "../lib/config/presentation.ts";
import { assignOverviewSlot, cleanOverviewSlots, emptyOverviewSlots } from "../lib/config/overview-slots.ts";
import { overviewSlotLayout, suggestOverviewSlots } from "../lib/dashboard/overview-slot-layout.ts";
import { isAvailabilityDivided } from "../lib/dashboard/layout.ts";

function fixture() {
  const document = initialPresentation(randomUUID), screen = document.screens[0];
  for (const type of ["signal_flow", "storage_summary"]) screen.blocks.push({ id: randomUUID(), type, enabled: true, width: "wide", options: effectiveOptions({ type, options: type === "storage_summary" ? { storageConfigId: randomUUID() } : {} }) });
  const byType = type => screen.blocks.find(block => block.type === type);
  screen.overviewGrid = "split_custom";
  screen.overviewSlots = { topLeft: [byType("highlighted_resources").id], topRight: [byType("signal_flow").id, byType("storage_summary").id], bottomLeft: [byType("asgard_summary").id], bottomRight: [byType("problems").id] };
  return { document, screen, byType };
}
test("custom slots validate the requested composition without changing legacy defaults or reading saves", () => {
  const { document, screen } = fixture();
  assert.equal(presentationDocumentSchema.safeParse(document).success, true);
  const legacy = initialPresentation(randomUUID);
  assert.equal(presentationDocumentSchema.parse(legacy).screens[0].overviewSlots, undefined);
  const saved = withReadingPlayback(legacy, document);
  assert.equal(saved.screens[0].overviewSlots, undefined);
  screen.layout = "wall"; delete screen.overviewSlots;
  assert.equal(presentationDocumentSchema.safeParse(document).success, true);
});
test("slots reject invalid identities, duplicates, overflow, unsupported pairs and missing placements", () => {
  const edits = [
    ({ screen }) => { delete screen.overviewSlots; },
    ({ screen }) => { screen.overviewSlots.topLeft = [randomUUID()]; },
    ({ screen }) => { screen.overviewSlots.bottomRight = screen.overviewSlots.bottomLeft; },
    ({ screen }) => { screen.overviewSlots.topRight.push(randomUUID()); },
    ({ screen }) => { screen.overviewSlots.topLeft.push(screen.overviewSlots.topRight.shift()); },
    ({ screen }) => { screen.overviewSlots.bottomRight = []; },
    ({ document }) => { document.schemaVersion = 1; },
  ];
  for (const edit of edits) { const data = fixture(); edit(data); assert.equal(presentationDocumentSchema.safeParse(data.document).success, false); }
  const data = fixture(); data.screen.overviewGrid = "default"; data.screen.overviewSlots.bottomRight = [];
  assert.equal(presentationDocumentSchema.safeParse(data.document).success, true);
});
test("the slot plan uses identities, collapses hidden members and empty rows and keeps per-block options", () => {
  const { screen, byType } = fixture();
  let plan = overviewSlotLayout(screen.blocks, screen.overviewSlots);
  assert.deepEqual(plan.rows[0].groups[1].blocks.map(block => block.id), screen.overviewSlots.topRight);
  assert.equal(plan.rows[0].groups[1].minimum, 432);
  byType("signal_flow").enabled = false;
  plan = overviewSlotLayout(screen.blocks.reverse(), screen.overviewSlots);
  assert.equal(plan.rows[0].groups[1].blocks[0].id, byType("storage_summary").id);
  assert.equal(plan.rows[0].groups[1].minimum, 210);
  byType("asgard_summary").enabled = false; byType("problems").enabled = false;
  assert.equal(overviewSlotLayout(screen.blocks, screen.overviewSlots).rows.length, 1);
  byType("storage_summary").enabled = false;
  assert.equal(isAvailabilityDivided(byType("highlighted_resources"), screen.blocks, false, false, screen.overviewSlots), false);
});
test("assignments move once, preserve array order and clean only removed block references", () => {
  const { screen, byType } = fixture();
  const moved = assignOverviewSlot(screen.overviewSlots, "bottomRight", 0, byType("signal_flow").id);
  assert.deepEqual(moved.topRight, [byType("storage_summary").id]);
  assert.deepEqual(moved.bottomRight, [byType("signal_flow").id]);
  byType("storage_summary").enabled = false;
  assert.deepEqual(cleanOverviewSlots(screen).overviewSlots, screen.overviewSlots);
  screen.blocks = screen.blocks.filter(block => block.type !== "storage_summary");
  assert.equal(cleanOverviewSlots(screen).overviewSlots.topRight.length, 1);
  assert.equal(screen.overviewSlots.topRight.length, 2);
});
test("initial suggestions do not mutate the current layout or choose resource identities", () => {
  const { screen } = fixture();
  const stored = structuredClone(screen.overviewSlots);
  assert.deepEqual(suggestOverviewSlots(screen), stored);
  delete screen.overviewSlots; screen.overviewGrid = "split";
  const suggested = suggestOverviewSlots(screen);
  assert.equal(suggested.topLeft[0], screen.blocks.find(block => block.type === "highlighted_resources").id);
  assert.equal(screen.overviewSlots, undefined);
  assert.deepEqual(emptyOverviewSlots(), { topLeft: [], topRight: [], bottomLeft: [], bottomRight: [] });
});
