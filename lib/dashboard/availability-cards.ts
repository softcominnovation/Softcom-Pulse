import type { OptionsByType } from "../config/presentation.ts";
import {
  formatAvailabilityCardRef, parseAvailabilityCardRef, type AvailabilityCardKind,
} from "../config/availability-card-refs.ts";
import type { StandaloneVpsHighlight } from "../config/standalone-vps.ts";
import type { AvailabilityPanelData, ConfiguredResource, ProbeCard, SignalOverviewCard } from "../monitoring/contracts.ts";
import { selectHighlights } from "./block-options.ts";

export type { AvailabilityCardKind, AvailabilityCardRef } from "../config/availability-card-refs.ts";
export {
  availabilityCardKinds, availabilityCardRefSchema, formatAvailabilityCardRef, parseAvailabilityCardRef,
} from "../config/availability-card-refs.ts";
export type { AvailabilityPanelData };

export type SignalAvailabilityCard = SignalOverviewCard;
export type AvailabilityPanelCard = AvailabilityPanelData["cards"][number];

export function collectCustomAvailabilityRefs(blocks: { type: string; enabled: boolean; options?: unknown }[]) {
  const refs: { kind: AvailabilityCardKind; id: string }[] = [];
  const seen = new Set<string>();
  for (const block of blocks) {
    if (!block.enabled || block.type !== "highlighted_resources") continue;
    const options = block.options as { selection?: string; cards?: string[] } | undefined;
    if (options?.selection !== "custom" || !Array.isArray(options.cards)) continue;
    for (const raw of options.cards) {
      const ref = parseAvailabilityCardRef(String(raw));
      if (!ref) continue;
      const key = formatAvailabilityCardRef(ref);
      if (seen.has(key)) continue;
      seen.add(key);
      refs.push(ref);
    }
  }
  return refs;
}

export function buildDefaultAvailabilityCards(
  resources: ConfiguredResource[],
  probes: ProbeCard[],
  vps: StandaloneVpsHighlight[],
  signalCards: SignalAvailabilityCard[],
  options: OptionsByType["highlighted_resources"],
): AvailabilityPanelCard[] {
  return [
    ...selectHighlights(resources, options).map(item => ({ kind: "resource" as const, item })),
    ...probes.map(item => ({ kind: "external_service" as const, item })),
    ...vps.map(item => ({ kind: "standalone_vps" as const, item })),
    ...signalCards.map(item => ({ kind: "signal_target" as const, item })),
  ];
}

export function buildCustomAvailabilityCards(
  cardRefs: string[],
  pools: {
    resources: Map<string, ConfiguredResource>;
    probes: Map<string, ProbeCard>;
    vps: Map<string, StandaloneVpsHighlight>;
    signalCards: Map<string, SignalAvailabilityCard>;
  },
): AvailabilityPanelCard[] {
  const cards: AvailabilityPanelCard[] = [];
  for (const raw of cardRefs) {
    const ref = parseAvailabilityCardRef(raw);
    if (!ref) continue;
    if (ref.kind === "resource") {
      const item = pools.resources.get(ref.id);
      if (item) cards.push({ kind: "resource", item });
      continue;
    }
    if (ref.kind === "external_service") {
      const item = pools.probes.get(ref.id);
      if (item) cards.push({ kind: "external_service", item });
      continue;
    }
    if (ref.kind === "standalone_vps") {
      const item = pools.vps.get(ref.id);
      if (item) cards.push({ kind: "standalone_vps", item });
      continue;
    }
    const item = pools.signalCards.get(ref.id);
    if (item) cards.push({ kind: "signal_target", item });
  }
  return cards;
}

export function isAvailabilityPanelData(data: unknown): data is AvailabilityPanelData {
  return !!data && typeof data === "object" && Array.isArray((data as AvailabilityPanelData).cards);
}

/** Resolve block payload: prefer server panel; legacy arrays still join global pools. */
export function resolveAvailabilityPanel(
  data: unknown,
  options: OptionsByType["highlighted_resources"],
  fallback: { probes: ProbeCard[]; vps: StandaloneVpsHighlight[]; signalCards: SignalAvailabilityCard[] },
): AvailabilityPanelData & { legacyResourceCount: number | null } {
  if (isAvailabilityPanelData(data)) return { cards: data.cards, legacyResourceCount: null };
  const resources = Array.isArray(data) ? data as ConfiguredResource[] : [];
  return {
    cards: buildDefaultAvailabilityCards(resources, fallback.probes, fallback.vps, fallback.signalCards, options),
    legacyResourceCount: resources.length,
  };
}
