import type { CardMetric } from "@/lib/config/agent-monitoring";
import { number } from "@/lib/dashboard/format";

export function CardReadings({ pair, values, diskLabel = "Disco" }: { pair: CardMetric[]; values: Record<CardMetric, number | null>; diskLabel?: string }) {
  const labels = { cpu: "CPU", memory: "RAM", disk: diskLabel };
  return <span className="availability-readings">{pair.map(kind => <span key={kind} className="availability-reading" title={kind === "disk" ? values.disk === null ? "Sem capacidade atual: confira a seleção de volumes e a leitura do Agent da VM." : "Ocupação da capacidade selecionada do Agent da VM." : undefined}>
    <span>{labels[kind]}<strong>{values[kind] === null ? "—" : `${number(values[kind], 1)}%`}</strong></span>
    <span className={`availability-meter${kind === "memory" ? " memory" : kind === "disk" ? " disk" : ""}`} aria-hidden="true"><i style={{ width: `${Math.max(0, Math.min(100, values[kind] ?? 0))}%` }} /></span>
  </span>)}</span>;
}
