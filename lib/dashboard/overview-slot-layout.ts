import { effectiveOptions, type PresentationBlock, type PresentationDocument } from "../config/presentation.ts";
import { emptyOverviewSlots, overviewSlotKeys, canPlaceOverviewBlock, type OverviewSlotKey, type OverviewSlots } from "../config/overview-slots.ts";
import { availabilityPanelMinimum, availabilityRowLimit } from "./availability-sizing.ts";
import { isAvailabilityDivided, overviewSplitRows, storageLayout, usesRowComposition } from "./layout.ts";

export const overviewStackGap = 12;
export const overviewPanelMinimum = 210;
export function overviewSlotLayout(blocks: PresentationBlock[], slots: OverviewSlots, monitor = false) {
  const active = blocks.filter(block => block.enabled), hasKpis = active.some(block => block.type === "summary");
  const minimum = (block: PresentationBlock) => {
    if (block.type !== "highlighted_resources") return overviewPanelMinimum;
    const options = effectiveOptions({ ...block, type: "highlighted_resources" });
    return availabilityPanelMinimum(options.cardSize, availabilityRowLimit(options.cardSize, options.visibleRows, isAvailabilityDivided(block, blocks, false, false, slots), hasKpis, options.rowMode), monitor);
  };
  const groups = overviewSlotKeys.map(key => {
    const panels = slots[key].flatMap(id => { const block = active.find(block => block.id === id); return block ? [block] : []; });
    return { key, blocks: panels, minimum: panels.reduce((sum, block) => sum + minimum(block), 0) + Math.max(0, panels.length - 1) * overviewStackGap };
  });
  const rows = [groups.slice(0, 2), groups.slice(2)].map(groups => groups.filter(group => group.blocks.length)).filter(groups => groups.length).map(groups => ({
    key: groups[0].key, groups, minimum: Math.max(...groups.map(group => group.minimum)),
    hasAvailability: groups.some(group => group.blocks.some(block => block.type === "highlighted_resources")),
  }));
  return { summaries: active.filter(block => block.type === "summary"), rows };
}

export function suggestOverviewSlots(screen: PresentationDocument["screens"][number]): OverviewSlots {
  if (screen.overviewSlots) return structuredClone(screen.overviewSlots);
  const slots = emptyOverviewSlots(), split = screen.overviewGrid === "split";
  const rows = split && !usesRowComposition(screen.blocks, true) ? overviewSplitRows(screen.blocks) : storageLayout(screen.blocks, split).rows.map(row => row.blocks.map(item => item.block));
  rows.slice(0, 2).forEach((row, index) => row.slice(0, 2).forEach((block, column) => {
    if (canPlaceOverviewBlock(block.type)) slots[overviewSlotKeys[index * 2 + column] as OverviewSlotKey] = [block.id];
  }));
  return slots;
}
