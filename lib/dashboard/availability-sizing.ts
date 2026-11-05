export const availabilityCardSizeOptions = ["compact", "expanded"] as const;
export type AvailabilityCardSize = typeof availabilityCardSizeOptions[number];
export const availabilityRowModeOptions = ["auto", "manual"] as const;
export type AvailabilityRowMode = typeof availabilityRowModeOptions[number];

export const availabilityCardSizes = {
  compact: { height: 120, minWidth: 230, gap: 8 },
  expanded: { height: 140, minWidth: 260, gap: 8 },
} as const;

/** Monitor cards reserve space for thicker meters and larger usage percentages. */
export function availabilityDimensions(size: AvailabilityCardSize, monitor = false) {
  const dimensions = availabilityCardSizes[size];
  return { ...dimensions, height: dimensions.height + (monitor ? 28 : 0) };
}

export function availabilityRowLimit(size: AvailabilityCardSize, configured: number, divided: boolean, hasKpis = false, mode?: AvailabilityRowMode) {
  if (mode === "manual") return configured;
  return size === "expanded" || mode === "auto" ? divided && !hasKpis ? 3 : 2 : configured;
}

export function availabilityGridHeight(size: AvailabilityCardSize, rows: number, exact = size === "expanded", monitor = false) {
  const dimensions = availabilityDimensions(size, monitor);
  return rows * (dimensions.height + dimensions.gap) + (exact ? 0 : 2);
}

export function availabilityPanelMinimum(size: AvailabilityCardSize, rows: number, monitor = false) {
  const dimensions = availabilityDimensions(size, monitor);
  return 90 + availabilityGridHeight(size, rows, size === "expanded", monitor) + dimensions.gap;
}
