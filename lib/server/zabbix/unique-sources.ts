import { keyParts } from "./observations.ts";
import type { Item } from "./types.ts";
// Same host + exact mount/key arguments prove logical identity. Direct Agent items
// take precedence over dependent copies; duplicates within that family are ambiguous.
export function uniqueSources(items: Item[]) {
  const groups = new Map<string, Item[]>();
  for (const item of items) {
    const { base, args } = keyParts(item.key_);
    const identity = JSON.stringify([base.replace("dependent.", ""), args]);
    groups.set(identity, [...(groups.get(identity) ?? []), item]);
  }
  return [...groups.values()].flatMap(candidates => {
    const direct = candidates.filter(item => !keyParts(item.key_).base.includes("dependent"));
    const preferred = direct.length ? direct : candidates;
    return preferred.length === 1 ? preferred : [];
  });
}

