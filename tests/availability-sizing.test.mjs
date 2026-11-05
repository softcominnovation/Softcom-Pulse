import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { effectiveOptions, initialPresentation, presentationWriteSchema, withReadingPlayback } from "../lib/config/presentation.ts";
import { availabilityGridHeight, availabilityPanelMinimum, availabilityRowLimit } from "../lib/dashboard/availability-sizing.ts";
import { isAvailabilityDivided, storageLayout } from "../lib/dashboard/layout.ts";
import { monitorFixture } from "./fixtures/monitor-compat.mjs";
import { renderCompatibleContent } from "../lib/server/monitor-compat/render.ts";

test("availability size is opt-in per block and reading saves cannot publish the draft", () => {
  const legacy = { visibleRows: 2 };
  assert.equal(effectiveOptions({ type: "highlighted_resources", options: legacy }).cardSize, "compact");
  assert.deepEqual(legacy, { visibleRows: 2 });
  const original = initialPresentation(randomUUID), draft = structuredClone(original);
  draft.screens[0].blocks[1].options.cardSize = "expanded";
  const { revision, ...settings } = draft;
  assert.equal(presentationWriteSchema.safeParse({ expectedRevision: revision, settings }).success, true);
  assert.equal(draft.screens[0].blocks[1].options.visibleRows, 1);
  assert.equal(withReadingPlayback(original, draft).screens[0].blocks[1].options.cardSize, "compact");
  for (const cardSize of ["large", "", null, 160]) {
    settings.screens[0].blocks[1].options.cardSize = cardSize;
    assert.equal(presentationWriteSchema.safeParse({ expectedRevision: revision, settings }).success, false);
  }
});

test("both panel budgets include every card row, gap and bottom spacing", () => {
  assert.equal(availabilityGridHeight("compact", 2), 258);
  assert.equal(availabilityGridHeight("expanded", 2), 296);
  assert.equal(availabilityPanelMinimum("compact", 2), 356);
  assert.equal(availabilityPanelMinimum("expanded", 2), 394);
  const blocks = initialPresentation(randomUUID).screens[0].blocks;
  blocks[1].options.cardSize = "expanded";
  assert.equal(storageLayout(blocks, true).rows[0].minimum, 394);
  blocks.find(block => block.type === "summary").enabled = false;
  assert.equal(storageLayout(blocks, true).rows[0].minimum, 542);
  blocks[1].options.cardSize = "compact";
  assert.equal(storageLayout(blocks, true).rows[0].minimum, 228);
});

test("classic initial HTML carries the expanded profile and its row budget without changing metric choices", () => {
  const model = monitorFixture(), block = model.screen.blocks.find(block => block.type === "highlighted_resources");
  block.options.cardSize = "expanded";
  const html = renderCompatibleContent(model);
  assert.match(html, /data-card-size="expanded"/);
  assert.match(html, /data-card-width="260" data-card-gap="8"/);
  assert.match(html, /max-height:296px/);
  assert.match(html, /data-expanded-row="true"/);
  assert.match(html, /RX/); assert.match(html, /TX/);
  assert.match(html, /VM configurada/); assert.match(html, /Serviço configurado/);
});

test("expanded row limits follow real placement, including previously saved two-row blocks", () => {
  const blocks = initialPresentation(randomUUID).screens[0].blocks, block = blocks[1];
  block.options.cardSize = "expanded"; block.options.visibleRows = 2;
  assert.equal(isAvailabilityDivided(block, blocks, true), true);
  assert.equal(isAvailabilityDivided(block, blocks, false), false);
  assert.equal(availabilityRowLimit("expanded", block.options.visibleRows, true), 3);
  assert.equal(availabilityRowLimit("expanded", block.options.visibleRows, true, true), 2);
  assert.equal(availabilityRowLimit("expanded", 1, false), 2);
  assert.equal(availabilityRowLimit("expanded", 1, false, true), 2);
  assert.equal(availabilityRowLimit("compact", 1, true), 1);
  assert.equal(block.options.visibleRows, 2);
  block.width = "wide";
  assert.equal(isAvailabilityDivided(block, blocks, false, true), true);
  assert.equal(effectiveOptions({ type: "highlighted_resources", options: { cardSize: "compact", visibleRows: 3 } }).visibleRows, 2);
  assert.equal(effectiveOptions({ type: "highlighted_resources", options: { cardSize: "expanded", visibleRows: 3 } }).visibleRows, 3);
});

test("explicit manual rows override KPIs and placement in both profiles while legacy defaults stay unchanged", () => {
  for (const size of ["compact", "expanded"]) for (const divided of [false, true]) for (const hasKpis of [false, true]) for (const rows of [1, 2, 3]) {
    const options = effectiveOptions({ type: "highlighted_resources", options: { cardSize: size, rowMode: "manual", visibleRows: rows } });
    assert.equal(options.visibleRows, rows);
    assert.equal(availabilityRowLimit(size, rows, divided, hasKpis, options.rowMode), rows);
    assert.equal(availabilityRowLimit(size, rows, divided, hasKpis, "auto"), divided && !hasKpis ? 3 : 2);
  }
  for (const rowMode of ["fixed", "", 1, null]) {
    const { revision, ...settings } = initialPresentation(randomUUID);
    settings.screens[0].blocks[1].options.rowMode = rowMode;
    assert.equal(presentationWriteSchema.safeParse({ expectedRevision: revision, settings }).success, false);
  }
  const legacy = { cardSize: "expanded", visibleRows: 1 };
  assert.equal(effectiveOptions({ type: "highlighted_resources", options: legacy }).rowMode, undefined);
  assert.deepEqual(legacy, { cardSize: "expanded", visibleRows: 1 });
  const blocks = initialPresentation(randomUUID).screens[0].blocks;
  blocks[1].options = { ...blocks[1].options, cardSize: "expanded", rowMode: "manual", visibleRows: 3 };
  assert.equal(storageLayout(blocks, true).rows[0].minimum, 542);
  blocks[1].options.cardSize = "compact";
  assert.equal(storageLayout(blocks, true).rows[0].minimum, 484);
});

test("classic HTML respects explicit rows before JavaScript, including one compact row in split", () => {
  const model = monitorFixture(), block = model.screen.blocks.find(block => block.type === "highlighted_resources");
  for (const size of ["compact", "expanded"]) for (const rows of [1, 2, 3]) {
    block.options = { ...block.options, cardSize: size, rowMode: "manual", visibleRows: rows };
    const html = renderCompatibleContent(model);
    assert.match(html, new RegExp(`data-row-mode="manual" data-card-rows="${rows}"`));
    assert.match(html, new RegExp(`max-height:${rows * (size === "compact" ? 128 : 148)}px`));
    assert.match(html, /data-measured-row="true"/);
  }
});
