import { useState } from "react";
import { ServiceAvailabilityCard } from "../../components/dashboard/service-availability-card";
import { EvidenceTimeContext } from "../../components/dashboard/metrics";
import { resolveAvailabilityCardMetrics } from "../../lib/monitoring/card-metrics";
import type { CardMetric } from "../../lib/config/agent-monitoring";
import { resourceCardData, type ResourceCardScenario } from "./resource-card-data";
import "../../components/dashboard/availability.css";

export function ResourceCardReadingsFixture({ mode = "selected", pair = ["cpu", "disk"], width = 230, source = "hypervisor" }: { mode?: ResourceCardScenario; pair?: CardMetric[]; width?: number; source?: "agent" | "hypervisor" }) {
  const [now] = useState(Date.now);
  const { resource, hosts } = resourceCardData(mode, pair, source);
  return <EvidenceTimeContext.Provider value={now}><div style={{ width }}><ServiceAvailabilityCard preview stale={false} item={{ ...resource, ...resolveAvailabilityCardMetrics(resource, hosts) }} /></div></EvidenceTimeContext.Provider>;
}
