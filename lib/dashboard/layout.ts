import { defaultDashboardBlocks, effectiveOptions, type PresentationBlock } from "../config/presentation.ts";

export function isBalancedComposition(blocks: PresentationBlock[]) {
  const visible = blocks.filter(block => block.enabled);
  return visible.length === defaultDashboardBlocks.length && visible.every((block, index) => {
    const options = effectiveOptions(block);
    const layoutOptions = block.type === "highlighted_resources" && "visibleRows" in options && options.visibleRows <= 2 ? { ...options, visibleRows: 1 } : options;
    return block.type === defaultDashboardBlocks[index].type && block.width === defaultDashboardBlocks[index].width && JSON.stringify(layoutOptions) === JSON.stringify(effectiveOptions({ type: block.type }));
  });
}
