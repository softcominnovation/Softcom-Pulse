import { defaultDashboardBlocks, type PresentationBlock } from "../config/presentation.ts";

export function isBalancedComposition(blocks: PresentationBlock[]) {
  const visible = blocks.filter(block => block.enabled);
  return visible.length === defaultDashboardBlocks.length && visible.every((block, index) => block.type === defaultDashboardBlocks[index].type && block.width === defaultDashboardBlocks[index].width);
}
