import { useState, type CSSProperties } from "react";
import { availabilityCardSizes, type AvailabilityCardSize } from "../../lib/dashboard/availability-sizing";
import { ServiceAvailabilityCard } from "../../components/dashboard/service-availability-card";
import { EvidenceTimeContext } from "../../components/dashboard/metrics";
import { resolveAvailabilityCardMetrics } from "../../lib/monitoring/card-metrics";
import type { CardMetric } from "../../lib/config/agent-monitoring";
import { resourceCardData, type ResourceCardScenario } from "./resource-card-data";
import "../../components/dashboard/availability.css";

export function ResourceCardReadingsFixture({ mode = "selected", pair = ["cpu", "disk"], width = 230, source = "hypervisor", size = "compact", scale = 100 }: { mode?: ResourceCardScenario; pair?: CardMetric[]; width?: number; source?: "agent" | "hypervisor"; size?: AvailabilityCardSize; scale?: number }) {
  const [now] = useState(Date.now);
  const dimensions = availabilityCardSizes[size];
  const { resource, hosts } = resourceCardData(mode, pair, source);
  return <EvidenceTimeContext.Provider value={now}><div className="availability-panel" data-card-size={size} style={{ width, "--dashboard-scale": scale / 100, "--availability-base-height": `${dimensions.height}px`, "--availability-base-width": `${dimensions.minWidth}px`, "--availability-base-gap": `${dimensions.gap}px` } as CSSProperties}><ServiceAvailabilityCard preview stale={false} item={{ ...resource, ...resolveAvailabilityCardMetrics(resource, hosts) }} /></div></EvidenceTimeContext.Provider>;
}
