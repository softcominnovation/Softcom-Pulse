"use client";

import { useId, useState } from "react";
import type { Container, History } from "@/lib/monitoring/contracts";
import { containerStates, healthStates } from "@/lib/services/presentation";
import { timestamp } from "@/lib/dashboard/format";

type Track = NonNullable<History["states"]>[number];
export function HealthTimeline({ track }: { track: Track }) {
  const [index, setIndex] = useState(0), id = useId();
  const segments = track.segments, selectedIndex = Math.min(index, segments.length - 1), selected = segments[selectedIndex];
  const start = Date.parse(segments[0]?.from ?? ""), end = Date.parse(segments.at(-1)?.to ?? ""), width = Math.max(1, end - start);
  const describe = (segment: Track["segments"][number]) => {
    const key = segment.observedAt ? segment.state : "unknown";
    return track.key === "health" ? healthStates[key as Container["health"]] ?? healthStates.unknown : containerStates[key as Container["status"]] ?? containerStates.unknown;
  };
  const label = track.key === "health" ? "Healthcheck" : "Estado do container";
  return <section className="health-timeline" aria-label={`Histórico de ${label}`}><h3>{label}</h3>
    {selected ? <>
      <svg viewBox="0 0 1000 28" preserveAspectRatio="none" role="img" aria-label={`${label}: intervalos observados; use o controle abaixo para consultar valores`}>
        {segments.map((segment, i) => <rect key={i} x={(Date.parse(segment.from) - start) / width * 1000} y="2" width={Math.max(.3, (Date.parse(segment.to) - Date.parse(segment.from)) / width * 1000)} height="24" className={`timeline-${describe(segment).tone}`} onClick={() => setIndex(i)}><title>{timestamp(segment.from)} — {timestamp(segment.to)} · {describe(segment).label}{!segment.observedAt ? " · Sem evidência" : ""}</title></rect>)}
      </svg><label htmlFor={id}>Consultar intervalo · toque ou teclado</label><input id={id} type="range" min={0} max={Math.max(0, segments.length - 1)} value={selectedIndex} onChange={event => setIndex(Number(event.target.value))} aria-valuetext={`${timestamp(selected.from)} até ${timestamp(selected.to)}: ${describe(selected).label}`} />
      <p className="timeline-readout" aria-live="polite"><strong>{describe(selected).label}</strong> · {timestamp(selected.from)} — {timestamp(selected.to)}<br />{selected.observedAt ? `Evidência: ${timestamp(selected.observedAt)}` : "Sem evidência neste intervalo"}</p>
    </> : <p>Sem histórico de {label.toLowerCase()} disponível.</p>}
    {track.coverageLimited && <p className="history-warning">Cobertura parcial. Intervalos sem evidência permanecem desconhecidos.</p>}
  </section>;
}
