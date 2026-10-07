"use client";

import { useCallback, useEffect, useId, useMemo, useState, useRef, type ReactElement } from "react";
import Link from "next/link";
import type uPlot from "uplot";
import { api } from "@/lib/client/api";
import { timestamp } from "@/lib/dashboard/format";
import type { ProbeCard } from "@/lib/monitoring/contracts";
import { certRemainingDays, formatLatency, formatUptime, probePresence, probeStatus } from "@/lib/probe/status";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { useProbeSelectionStore } from "@/store/probe-selection.store";
import { probeLiveRefreshMs, UptimeTrack } from "./probe-strip";
import "uplot/dist/uPlot.min.css";

const ranges = [["24h", "24 horas"], ["7d", "7 dias"], ["30d", "30 dias"]] as const;
type Range = typeof ranges[number][0];
type Point = { checkedAt: string; reason: number; latencyMs: number | null };
type History = { points: Point[]; summary: { currentLatencyMs: number | null; averageLatencyMs: number | null; uptime24h: { available: number; total: number } | null; uptime7d: { available: number; total: number } | null; uptime30d: { available: number; total: number } | null } };
const axisTime = new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Fortaleza", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

function certText(value: string | null) {
  const days = certRemainingDays(value);
  if (days === null) return null;
  if (days < 0) return "Certificado expirado.";
  if (days === 0) return "Certificado expira hoje.";
  return `Certificado: ${days.toLocaleString("pt-BR")} dia(s) restante(s).`;
}
function LatencyChart({ points }: { points: Point[] }) {
  const holder = useRef<HTMLDivElement>(null), plot = useRef<uPlot | null>(null);
  const data = useMemo(() => [points.map(point => Date.parse(point.checkedAt) / 1000), points.map(point => point.latencyMs)] as uPlot.AlignedData, [points]);
  const [index, setIndex] = useState<number | null>(null), [unavailable, setUnavailable] = useState(false);
  const pointId = useId();
  const current = Math.min(index ?? data[0].length - 1, Math.max(0, data[0].length - 1));
  const onCursor = useCallback((chart: uPlot) => { if (chart.cursor.idx != null) setIndex(chart.cursor.idx); }, []);
  const observed = points.some(point => point.latencyMs !== null);
  useEffect(() => {
    const target = holder.current;
    if (!target || data[0].length < 2 || !observed) return;
    let disposed = false, observer: ResizeObserver | undefined;
    void import("uplot").then(({ default: Plot }) => {
      if (disposed) return;
      const chart = new Plot({ width: Math.max(220, target.clientWidth), height: 230, legend: { show: false }, select: { show: false, left: 0, top: 0, width: 0, height: 0 }, cursor: { drag: { x: false, y: false }, points: { show: true } },
        scales: { x: { time: true } }, series: [{}, { label: "Latência", stroke: "#64d6b0", width: 1.6, spanGaps: false, points: { show: true, size: 3 } }],
        axes: [
          { stroke: "#9daeb9", font: "10px Consolas, monospace", grid: { show: false }, size: 44, space: 115, values: (_chart, ticks) => ticks.map(value => axisTime.format(new Date(value * 1000))) },
          { stroke: "#9daeb9", font: "10px Consolas, monospace", size: 64, grid: { stroke: "#2a3943", dash: [3, 4], width: 1 }, values: (_chart, ticks) => ticks.map(value => `${Math.round(value).toLocaleString("pt-BR")} ms`) },
        ], hooks: { setCursor: [onCursor] },
      }, data, target);
      plot.current = chart;
      observer = new ResizeObserver(entries => { const width = entries[0]?.contentRect.width; if (width && !disposed) chart.setSize({ width: Math.max(220, Math.floor(width)), height: 230 }); });
      observer.observe(target);
    }).catch(() => { if (!disposed) setUnavailable(true); });
    return () => { disposed = true; observer?.disconnect(); plot.current?.destroy(); plot.current = null; };
  }, [data, observed, onCursor]);
  if (!points.length) return <p className="panel-empty">Sem consultas neste período.</p>;
  const selected = points[current], selectedTime = data[0][current];
  return <div className="history-chart">
    {data[0].length >= 2 && observed && !unavailable ? <div className="history-canvas" ref={holder} aria-hidden="true" /> : <p className="panel-empty">{data[0].length < 2 ? `Amostra única: ${formatLatency(points[0].latencyMs)} · ${probeStatus(points[0].reason).label}.` : !observed ? "Consultas sem latência neste período." : "Gráfico indisponível. Os valores continuam disponíveis abaixo."}</p>}
    {data[0].length > 1 && <div className="history-point-reader"><label htmlFor={pointId}>Consultar amostra · toque ou teclado</label><input id={pointId} type="range" min={0} max={data[0].length - 1} value={current} onChange={event => setIndex(Number(event.target.value))} aria-valuetext={timestamp(new Date(selectedTime * 1000).toISOString())} />
      <div className="history-tooltip" aria-live="polite" aria-atomic="true"><time dateTime={selected.checkedAt}>{timestamp(selected.checkedAt)} · Fortaleza</time><dl><div><dt><i style={{ background: "#64d6b0" }} />Latência</dt><dd>{formatLatency(selected.latencyMs)}</dd></div><div><dt>Resultado</dt><dd>{probeStatus(selected.reason).label}</dd></div></dl></div>
    </div>}
  </div>;
}
export function ProbeHistoryPanel({ serviceId, certNotAfter = null, paused = false, progressStartedAt = null }: { serviceId: string; certNotAfter?: string | null; paused?: boolean; progressStartedAt?: string | null }) {
  const [range, setRange] = useState<Range>("24h");
  const [state, setState] = useState<{ loading: boolean; failed: boolean; data: History | null }>({ loading: true, failed: false, data: null });
  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined, alive = true;
    const load = (initial: boolean) => {
      clearTimeout(timer);
      if (document.hidden) { timer = setTimeout(() => load(initial), probeLiveRefreshMs); return; }
      if (initial) setState(current => ({ loading: current.data === null, failed: false, data: current.data }));
      api.get<{ data: History }>(`/monitoring/external-services/${serviceId}/history`, { params: { range }, signal: controller.signal }).then(response => {
        if (!alive || controller.signal.aborted) return;
        const next = response.data.data;
        setState(current => {
          const same = current.data && current.data.points.length === next.points.length && current.data.points.at(-1)?.checkedAt === next.points.at(-1)?.checkedAt;
          return same ? { ...current, loading: false, failed: false } : { loading: false, failed: false, data: next };
        });
      }).catch(() => {
        if (alive && !controller.signal.aborted) setState(current => ({ loading: false, failed: current.data === null, data: current.data }));
      }).finally(() => { if (alive && !controller.signal.aborted) timer = setTimeout(() => load(false), probeLiveRefreshMs); });
    };
    load(true);
    const visible = () => { if (!document.hidden) { clearTimeout(timer); load(false); } };
    document.addEventListener("visibilitychange", visible);
    return () => { alive = false; controller.abort(); clearTimeout(timer); document.removeEventListener("visibilitychange", visible); };
  }, [serviceId, range]);
  const certificate = certText(certNotAfter);
  const summary = state.data?.summary;
  const points = state.data?.points ?? [];
  return <div className="probe-history">
    <div className="probe-ranges" role="group" aria-label="Janela do histórico">{ranges.map(([value, label]) => <button key={value} type="button" aria-pressed={range === value} onClick={() => setRange(value)}>{label}</button>)}</div>
    {certificate && <p className="probe-cert">{certificate}</p>}
    {state.loading && <p className="panel-empty">Carregando consultas…</p>}
    {state.failed && <p className="admin-error" role="alert">Não foi possível ler o histórico. Os cards do dashboard não foram alterados.</p>}
    <section className="probe-uptime-block"><h3 className="probe-section-title">Uptime</h3><UptimeTrack reasons={paused ? [] : points.filter(point => !progressStartedAt || point.checkedAt >= progressStartedAt).map(point => point.reason)} /></section>
    {summary && <>
      <div className="probe-summary">
        <div><span>Disponibilidade 24 h</span><strong>{formatUptime(summary.uptime24h)}</strong></div>
        <div><span>Disponibilidade 7 dias</span><strong>{formatUptime(summary.uptime7d)}</strong></div>
        <div><span>Disponibilidade 30 dias</span><strong>{formatUptime(summary.uptime30d)}</strong></div>
        <div><span>Resposta atual</span><strong>{formatLatency(summary.currentLatencyMs)}</strong></div>
        <div><span>Resposta média</span><strong>{formatLatency(summary.averageLatencyMs)}</strong></div>
      </div>
      <section className="probe-latency-block"><h3 className="probe-section-title">Latência</h3>{points.length ? <LatencyChart points={points} /> : <p className="panel-empty">Sem consultas neste período.</p>}</section>
    </>}
  </div>;
}
function ProbeHistory({ item }: { item: ProbeCard }) {
  const presence = item.paused ? { label: "Pausado", tone: "unknown" as const } : probePresence(item.reason);
  return <>
    <DialogHeader><DialogTitle><span className={`app-presence tone-${presence.tone}`}>{presence.label}</span> {item.displayName}</DialogTitle><DialogDescription>{item.description?.trim() || item.serviceType?.trim() || "Aplicação"} · {item.paused ? "Pausado" : probeStatus(item.reason).label}</DialogDescription><Link className="probe-admin-link" href="/admin/aplicacoes" onClick={() => useProbeSelectionStore.getState().select(item.id)}>Abrir em Aplicações</Link></DialogHeader>
    <DialogBody><ProbeHistoryPanel serviceId={item.id} certNotAfter={item.certNotAfter} paused={item.paused} progressStartedAt={item.progressStartedAt} /></DialogBody>
  </>;
}
export function ProbeDetails({ item, trigger }: { item: ProbeCard; trigger: ReactElement }) {
  const [open, setOpen] = useState(false);
  return <Dialog open={open} onOpenChange={setOpen}><DialogTrigger asChild>{trigger}</DialogTrigger><DialogContent className="probe-dialog">{open && <ProbeHistory item={item} />}</DialogContent></Dialog>;
}
