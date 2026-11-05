import { z } from "zod";
import { uuidSchema } from "./resources.ts";

export const overviewSlotKeys = ["topLeft", "topRight", "bottomLeft", "bottomRight"] as const;
export type OverviewSlotKey = typeof overviewSlotKeys[number];
export const overviewSlotLabels: Record<OverviewSlotKey, string> = { topLeft: "Superior esquerdo", topRight: "Superior direito", bottomLeft: "Inferior esquerdo", bottomRight: "Inferior direito" };
export const overviewSlotsSchema = z.strictObject({ topLeft: z.array(uuidSchema).max(2), topRight: z.array(uuidSchema).max(2), bottomLeft: z.array(uuidSchema).max(2), bottomRight: z.array(uuidSchema).max(2) });
export type OverviewSlots = z.infer<typeof overviewSlotsSchema>;
export const emptyOverviewSlots = (): OverviewSlots => ({ topLeft: [], topRight: [], bottomLeft: [], bottomRight: [] });
export const canStackOverviewBlock = (type: string) => ["problems", "asgard_summary", "signal_flow", "storage_summary"].includes(type);
export const canPlaceOverviewBlock = (type: string) => type === "highlighted_resources" || canStackOverviewBlock(type);

export function cleanOverviewSlots<T extends { blocks: { id: string }[]; overviewSlots?: OverviewSlots }>(screen: T): T {
  if (!screen.overviewSlots) return screen;
  const ids = new Set(screen.blocks.map(block => block.id));
  return { ...screen, overviewSlots: Object.fromEntries(overviewSlotKeys.map(key => [key, screen.overviewSlots![key].filter(id => ids.has(id))])) as OverviewSlots };
}

export function assignOverviewSlot(slots: OverviewSlots, key: OverviewSlotKey, index: number, id: string): OverviewSlots {
  const next = Object.fromEntries(overviewSlotKeys.map(slot => [slot, slots[slot].filter(value => !id || value !== id)])) as OverviewSlots;
  const previous = slots[key].filter((_, position) => position !== index).filter(value => value !== id);
  next[key] = id ? index === 0 ? [id, ...previous].slice(0, 2) : [...previous, id].slice(0, 2) : previous;
  return next;
}
