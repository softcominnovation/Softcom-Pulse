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

/** Overview padrão: se só restam dois painéis ASGARD/Problemas/Signal (sem outro bloco compacto),
 *  exibe-os como wide para preencher a fileira — telas adicionais com “standard” salvos. */
export function overviewBlockWidth(block: PresentationBlock, enabled: PresentationBlock[], split: boolean): PresentationBlock["width"] {
  if (split || block.width === "full" || !overviewPairTypes.has(block.type)) return block.width;
  const nonFull = enabled.filter(item => item.width !== "full");
  const pair = nonFull.filter(item => overviewPairTypes.has(item.type));
  const other = nonFull.filter(item => !overviewPairTypes.has(item.type));
  return pair.length === 2 && other.length === 0 ? "wide" : block.width;
}
