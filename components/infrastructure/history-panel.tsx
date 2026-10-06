"use client";

import { useId, useMemo, useState, type ReactNode } from "react";
import { Activity, RefreshCw } from "lucide-react";
import type { History, Host } from "@/lib/monitoring/contracts";
import { historyGroups } from "@/lib/infrastructure/history";
import { timestamp } from "@/lib/dashboard/format";
import { Button } from "@/components/ui/button";
import { HistoryChart } from "./history-chart";
import { useHistory } from "./use-history";

export function RangeControls({ range, onChange }: { range: History["window"]; onChange: (range: History["window"]) => void }) {
  return <div className="history-ranges" role="group" aria-label="Período do gráfico">{([['1h', '1 hora'], ['24h', '24 horas'], ['7d', '7 dias']] as const).map(([value, label]) => <Button key={value} aria-pressed={value === range} onClick={() => onChange(value)}>{label}</Button>)}</div>;
}
export function HistoryPanel({ resource, range, name, origin, host, controls, summary }: { resource: History["resource"]; range: History["window"]; name: string; origin: string; host?: Host; controls?: ReactNode; summary?: ReactNode }) {
  const history = useHistory(resource, range), result = history.data;
  const [choice, setChoice] = useState<string | null>(null);
  const id = useId();
  const groups = useMemo(() => result ? historyGroups(result.data, host) : [], [result, host]);
  const group = groups.find(item => item.key === choice) ?? groups.find(item => item.series.some(series => series.points.some(point => point.value !== null))) ?? groups[0];
  return <section className={`dashboard-panel history-panel${summary ? " history-panel-with-summary" : ""}`} aria-label={`Histórico de ${name}`} aria-busy={history.loading}>
    <div className="panel-heading"><Activity aria-hidden="true" /><h2>Histórico de uso · {name}</h2>{summary && controls && <div className="history-controls">{controls}</div>}<Button size="icon" onClick={history.refresh} disabled={history.loading} aria-label={`Atualizar histórico de ${name}`}><RefreshCw aria-hidden="true" /></Button></div>
    <p className="history-origin">{origin} · {range === "1h" ? "1 hora" : range === "24h" ? "24 horas" : "7 dias"}</p>
    {!summary && controls && <div className="history-controls">{controls}</div>}
    {history.failed && <div className="history-error" role="alert">Não foi possível carregar o histórico.{result ? " A última leitura desta seleção foi mantida." : " Tente atualizar novamente."}<Button onClick={history.refresh}>Tentar novamente</Button></div>}
    {history.loading && <p className="panel-empty" role="status">Carregando histórico…</p>}
    {result && <>
      {(result.stale || history.failed) && <p className="history-warning" role="status">Histórico com evidência desatualizada. Não confirma o estado atual.</p>}
      {result.data.coverageLimited && <p className="history-warning">Cobertura parcial nesta janela. Lacunas representam períodos sem evidência.</p>}
      {group ? <><div className="history-metric-picker"><label htmlFor={id}>Métricas de {name}</label><select id={id} value={group.key} onChange={event => setChoice(event.target.value)}>{groups.map(item => <option key={item.key} value={item.key}>{item.label}</option>)}</select></div><HistoryChart key={`${resource.type}:${resource.hostKey}:${resource.reference}:${range}:${group.key}`} group={group} /></> : <p className="panel-empty">Nenhuma série disponível para este recurso e período.</p>}
    </>}
    {summary}
    {result && <p className="panel-foot">{result.data.source === "trends" ? "Médias horárias · mínimos e máximos disponíveis na leitura da amostra." : "Amostras observadas · mínimos e máximos por intervalo quando disponíveis."} Última evidência: {timestamp(result.lastUpdated)}. CPU verde · RAM azul · disco âmbar: cores de métricas, não severidade.</p>}
  </section>;
}
