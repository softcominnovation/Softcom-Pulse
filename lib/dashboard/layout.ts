import { defaultDashboardBlocks, effectiveOptions, type PresentationBlock } from "../config/presentation.ts";

const overviewPairTypes = new Set(["asgard_summary", "problems", "signal_flow"]);

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
