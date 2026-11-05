export const availabilityCardSizeOptions = ["compact", "expanded"] as const;
export type AvailabilityCardSize = typeof availabilityCardSizeOptions[number];
export const availabilityRowModeOptions = ["auto", "manual"] as const;
export type AvailabilityRowMode = typeof availabilityRowModeOptions[number];

export const availabilityCardSizes = {
  compact: { height: 120, minWidth: 230, gap: 8 },
  expanded: { height: 140, minWidth: 260, gap: 8 },
} as const;

export function availabilityRowLimit(size: AvailabilityCardSize, configured: number, divided: boolean, hasKpis = false, mode?: AvailabilityRowMode) {
  if (mode === "manual") return configured;
  return size === "expanded" || mode === "auto" ? divided && !hasKpis ? 3 : 2 : configured;
}

export function availabilityGridHeight(size: AvailabilityCardSize, rows: number, exact = size === "expanded") {
  const dimensions = availabilityCardSizes[size];
  return rows * (dimensions.height + dimensions.gap) + (exact ? 0 : 2);
}

export function availabilityPanelMinimum(size: AvailabilityCardSize, rows: number) {
  const dimensions = availabilityCardSizes[size];
  return 90 + availabilityGridHeight(size, rows) + dimensions.gap;
}
