import { AvailabilityCardHeader } from "@/components/dashboard/availability-card-header";
import { CardReadings } from "../../components/dashboard/card-readings";
import type { CSSProperties } from "react";
import { availabilityCardSizes, type AvailabilityCardSize } from "../../lib/dashboard/availability-sizing";
import type { CardMetric } from "../../lib/config/agent-monitoring";
import "../../components/dashboard/availability.css";

export function AgentCardReadingsFixture({ pair, missing = false, size = "compact", scale = 100 }: { pair: CardMetric[]; missing?: boolean; size?: AvailabilityCardSize; scale?: number }) {
  const dimensions = availabilityCardSizes[size];
  return <div className="availability-panel" data-card-size={size} style={{ width: dimensions.minWidth * scale / 100, "--dashboard-scale": scale / 100, "--availability-base-height": `${dimensions.height}px`, "--availability-base-width": `${dimensions.minWidth}px`, "--availability-base-gap": `${dimensions.gap}px` } as CSSProperties}><article className="availability-card"><AvailabilityCardHeader name="VM" label="Disponível" tone="good" /><span className="availability-description">Signal</span><CardReadings pair={pair} values={{ cpu: 12, memory: 25, disk: missing ? null : 72 }} diskLabel={missing ? "Disco da VM" : "Disco"} /><span className="availability-footer">Agent</span></article></div>;
}
