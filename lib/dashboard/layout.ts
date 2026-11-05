import { defaultDashboardBlocks, effectiveOptions, type PresentationBlock } from "../config/presentation.ts";
import { availabilityPanelMinimum, availabilityRowLimit } from "./availability-sizing.ts";

const overviewPairTypes = new Set(["asgard_summary", "problems", "signal_flow", "storage_summary"]);

export function isBalancedComposition(blocks: PresentationBlock[]) {
  const visible = blocks.filter(block => block.enabled);
  return visible.length === defaultDashboardBlocks.length && visible.every((block, index) => {
    const options = effectiveOptions(block);
    const layoutOptions = block.type === "highlighted_resources" && "visibleRows" in options && options.visibleRows <= 2 ? { ...options, visibleRows: 1 } : options;
    return block.type === defaultDashboardBlocks[index].type && block.width === defaultDashboardBlocks[index].width && JSON.stringify(layoutOptions) === JSON.stringify(effectiveOptions({ type: block.type }));
  });
}

type WidthMode = { split: boolean; wall?: boolean };
const splitTypes = new Set(["highlighted_resources", "problems", "asgard_summary", "signal_flow"]);
const flexibleRow = "minmax(calc(210px * var(--dashboard-scale, 1)), 1fr)";
const intrinsicRow = "minmax(min-content, 1fr)";

export function usesRowComposition(blocks: PresentationBlock[], split: boolean) {
  const enabled = blocks.filter(block => block.enabled);
  return enabled.some(block => block.type === "storage_summary") || split && [...splitTypes].some(type => enabled.filter(block => block.type === type).length > 1);
}

export function overviewSplitRows(blocks: PresentationBlock[]) {
  const find = (type: string) => blocks.find(block => block.enabled && block.type === type);
  const availability = find("highlighted_resources"), problems = find("problems"), asgard = find("asgard_summary"), signal = find("signal_flow");
  return [[availability, problems ?? (availability ? signal : undefined)], [asgard, problems || !availability ? signal : undefined]]
    .map(row => row.filter((block): block is PresentationBlock => !!block)).filter(row => row.length);
}

export function overviewSplitTracks(blocks: PresentationBlock[]) {
  const rows = overviewSplitRows(blocks), hasProblems = blocks.some(block => block.enabled && block.type === "problems");
  const area = (block: PresentationBlock) => block.type === "highlighted_resources" ? "avail" : block.type === "asgard_summary" ? "asgard" : block.type === "problems" || !hasProblems ? "side" : "signal";
  return {
    areas: rows.map(row => `"${area(row[0])} ${area(row[1] ?? row[0])}"`).join(" ") || "none",
    rows: rows.map(row => row.some(block => block.type === "highlighted_resources") ? rows.length > 1 ? "max-content" : intrinsicRow : flexibleRow).join(" ") || "none",
  };
}

export function isAvailabilityDivided(block: PresentationBlock, blocks: PresentationBlock[], split: boolean, wall = false) {
  const enabled = blocks.filter(item => item.enabled);
  if (split) {
    if (!usesRowComposition(enabled, split)) return (overviewSplitRows(enabled).find(row => row.some(item => item.id === block.id))?.length ?? 0) > 1;
    if (enabled.filter(item => item.type === "highlighted_resources").length === 1 && enabled.filter(item => item.type === "problems").length === 1) return true;
  }
  return displayBlockWidth(block, enabled, { split: false, wall }) !== "full";
}

export function dashboardGridRows(blocks: PresentationBlock[], split: boolean, wall = false): string {
  const enabled = blocks.filter(block => block.enabled);
  const flexible = flexibleRow;
  if (split) {
    const gridTypes = new Set(["highlighted_resources", "problems", "asgard_summary", "signal_flow"]);
    return [
      ...enabled.filter(block => block.type === "summary").map(() => "max-content"),
      ...(enabled.some(block => gridTypes.has(block.type)) ? [intrinsicRow] : []),
      ...enabled.filter(block => block.type !== "summary" && !gridTypes.has(block.type)).map(() => flexible),
    ].join(" ");
  }
  const rows: PresentationBlock[][] = [];
  let occupied = 12;
  for (const block of enabled) {
    const width = displayBlockWidth(block, enabled, { split: false, wall });
    const span = width === "full" ? 12 : width === "wide" ? 6 : 4;
    if (occupied + span > 12) { rows.push([]); occupied = 0; }
    rows.at(-1)!.push(block); occupied += span;
  }
  return rows.map(row => row.every(block => block.type === "summary" || block.type === "highlighted_resources") ? "max-content" : flexible).join(" ");
}

function pairSiblings(enabled: PresentationBlock[]) {
  const nonFull = enabled.filter(item => item.width !== "full");
  return {
    pair: nonFull.filter(item => overviewPairTypes.has(item.type)),
    other: nonFull.filter(item => !overviewPairTypes.has(item.type)),
  };
}

/** Overview padrão: se só restam dois painéis ASGARD/Problemas/Signal (sem outro bloco compacto),
 *  exibe-os como wide para preencher a fileira — telas adicionais com “standard” salvos. */
export function overviewBlockWidth(block: PresentationBlock, enabled: PresentationBlock[], split: boolean): PresentationBlock["width"] {
  return displayBlockWidth(block, enabled, { split, wall: false });
}

/** Largura efetiva na grade: overview (par) e wall (1/2/3 colunas iguais no espírito do protótipo). */
export function displayBlockWidth(block: PresentationBlock, enabled: PresentationBlock[], mode: WidthMode): PresentationBlock["width"] {
  if (mode.split || block.width === "full" || !overviewPairTypes.has(block.type)) return block.width;
  const { pair, other } = pairSiblings(enabled);
  if (other.length > 0 || !pair.some(item => item.id === block.id)) return block.width;
  if (mode.wall) {
    if (pair.length === 1) return "full";
    if (pair.length === 2) return "wide";
    if (pair.length === 3) return "standard";
    return block.width;
  }
  return pair.length === 2 ? "wide" : block.width;
}

/** Storage compositions are packed by block identity; duplicate types never share an area. */
export function storageLayout(blocks: PresentationBlock[], split: boolean, wall = false) {
  const enabled = blocks.filter(block => block.enabled);
  const hasKpis = enabled.some(block => block.type === "summary");
  const summaries = enabled.filter(block => block.type === "summary");
  let panels = enabled.filter(block => block.type !== "summary");
  const availability = panels.filter(block => block.type === "highlighted_resources"), problems = panels.filter(block => block.type === "problems");
  type Row = { paired: boolean; minimum: number; blocks: { block: PresentationBlock; span: number }[] };
  const minimum = (block: PresentationBlock) => {
    if (block.type !== "highlighted_resources") return 210;
    const options = effectiveOptions({ ...block, type: "highlighted_resources" });
    return availabilityPanelMinimum(options.cardSize, availabilityRowLimit(options.cardSize, options.visibleRows, isAvailabilityDivided(block, enabled, split, wall), hasKpis, options.rowMode));
  };
  const rows: Row[] = [];
  if (split && availability.length === 1 && problems.length === 1) {
    const top = [availability[0], problems[0]];
    const options = effectiveOptions({ ...availability[0], type: "highlighted_resources" });
    rows.push({ paired: true, minimum: Math.max(minimum(top[1]), availabilityPanelMinimum(options.cardSize, availabilityRowLimit(options.cardSize, options.visibleRows, true, hasKpis, options.rowMode))), blocks: top.map(block => ({ block, span: 6 })) });
    panels = panels.filter(block => !top.some(item => item.id === block.id));
  }
  let occupied = 12;
  for (const block of panels) {
    const width = displayBlockWidth(block, panels, { split: false, wall });
    const span = width === "full" ? 12 : width === "wide" ? 6 : 4;
    if (occupied + span > 12) { rows.push({ paired: false, minimum: 0, blocks: [] }); occupied = 0; }
    const row = rows.at(-1)!;
    row.blocks.push({ block, span }); row.minimum = Math.max(row.minimum, minimum(block)); occupied += span;
  }
  return { summaries, rows: rows.map(row => ({ ...row, contentSized: row.blocks.every(({ block }) => block.type === "highlighted_resources") })) };
}
