import { defaultDashboardBlocks, effectiveOptions, type PresentationBlock } from "../config/presentation.ts";

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
  const summaries = enabled.filter(block => block.type === "summary");
  let panels = enabled.filter(block => block.type !== "summary");
  const availability = panels.filter(block => block.type === "highlighted_resources"), problems = panels.filter(block => block.type === "problems");
  type Row = { paired: boolean; minimum: number; blocks: { block: PresentationBlock; span: number }[] };
  const minimum = (block: PresentationBlock) => block.type === "highlighted_resources" ? 90 + 120 * effectiveOptions({ ...block, type: "highlighted_resources" }).visibleRows : 210;
  const rows: Row[] = [];
  if (split && availability.length === 1 && problems.length === 1) {
    const top = [availability[0], problems[0]];
    rows.push({ paired: true, minimum: Math.max(...top.map(minimum)), blocks: top.map(block => ({ block, span: 6 })) });
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
  return { summaries, rows };
}
