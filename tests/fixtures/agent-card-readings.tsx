import { CardReadings } from "../../components/dashboard/card-readings";
import type { CardMetric } from "../../lib/config/agent-monitoring";
import "../../components/dashboard/availability.css";

export function AgentCardReadingsFixture({ pair, missing = false }: { pair: CardMetric[]; missing?: boolean }) {
  return <article className="availability-card" style={{ width: 230 }}><span className="availability-state">Disponível</span><strong className="availability-name">VM</strong><span className="availability-description">Signal</span><CardReadings pair={pair} values={{ cpu: 12, memory: 25, disk: missing ? null : 72 }} diskLabel={missing ? "Disco da VM" : "Disco"} /><span className="availability-footer">Agent</span></article>;
}
