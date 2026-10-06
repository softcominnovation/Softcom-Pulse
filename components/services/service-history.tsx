"use client";

import { useMemo, useState } from "react";
import type { ConfiguredResource, History } from "@/lib/monitoring/contracts";
import { historyGroups } from "@/lib/infrastructure/history";
import { visibleMetric } from "@/lib/services/presentation";
import { useHistory } from "@/components/infrastructure/use-history";
import { HistoryChart } from "@/components/infrastructure/history-chart";
import { RangeControls } from "@/components/infrastructure/history-panel";
import { Button } from "@/components/ui/button";
import { HealthTimeline } from "./health-timeline";

export function ServiceHistory({ item }: { item: ConfiguredResource }) {
  const p = item.config.presentation;
  const [range, setRange] = useState<History["window"]>(p.healthTimelineRange ?? "1h");
  const [choice, setChoice] = useState("");
  const poll = useHistory({ type: "configured_resource", hostKey: item.config.zabbixHostKey, reference: item.id }, range);
  const groups = useMemo(() => poll.data ? historyGroups({ ...poll.data.data, series: poll.data.data.series.filter(series => visibleMetric(series.key, p)) }, item.resource && "availability" in item.resource ? item.resource : undefined) : [], [poll.data, p, item.resource]);
  const group = groups.find(group => group.key === choice) ?? groups[0];
  const timeline = "showHealthTimeline" in p && p.showHealth && p.showHealthTimeline;
  return <section className="service-history" aria-label="Histórico do recurso"><div className="service-history-heading"><h3>Histórico observado pelo Zabbix</h3><RangeControls range={range} onChange={setRange} /></div>
    {poll.failed && <div className="history-error" role="alert">Falha ao consultar histórico. {poll.data ? "A última leitura deste período foi mantida." : "Tente novamente."}<Button onClick={poll.refresh}>Tentar novamente</Button></div>}
    {poll.loading && <p role="status">Carregando histórico…</p>}
    {(poll.data?.stale || poll.failed && poll.data) && <p className="history-warning">Evidência desatualizada; não confirma o estado atual.</p>}
    {poll.data?.data.coverageLimited && <p className="history-warning">Cobertura parcial nesta janela.</p>}
    {group && <><label className="history-metric-picker">Métricas do histórico<select value={group.key} onChange={event => setChoice(event.target.value)}>{groups.map(group => <option key={group.key} value={group.key}>{group.label}</option>)}</select></label><HistoryChart key={`${item.id}:${range}:${group.key}`} group={group} /></>}
    {poll.data && !group && <p className="panel-empty">Sem séries numéricas disponíveis para as métricas habilitadas.</p>}
    {timeline && poll.data && <div className="health-timelines">{["health", ...(p.showStatus ? ["status"] : [])].map(key => <HealthTimeline key={`${item.id}:${range}:${key}`} track={poll.data!.data.states?.find(track => track.key === key) ?? { key: key as "health" | "status", aggregation: "worst_state", coverageLimited: true, segments: [] }} />)}<p className="service-note">Estado e health são evidências diferentes. Parado permanece parado mesmo com health antigo saudável; lacunas não indicam sucesso.</p></div>}
  </section>;
}
