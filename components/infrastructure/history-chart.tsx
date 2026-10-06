"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import type uPlot from "uplot";
import type { ChartGroup } from "@/lib/infrastructure/history";
import { alignSeries, historyValue } from "@/lib/infrastructure/history";
import { timestamp } from "@/lib/dashboard/format";
import "uplot/dist/uPlot.min.css";

const axisTime = new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Fortaleza", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
export function HistoryChart({ group }: { group: ChartGroup }) {
  const holder = useRef<HTMLDivElement>(null), plot = useRef<uPlot | null>(null);
  const data = useMemo(() => alignSeries(group.series), [group.series]);
  const [index, setIndex] = useState<number | null>(null), [unavailable, setUnavailable] = useState(false);
  const pointId = useId();
  const current = Math.min(index ?? data[0].length - 1, data[0].length - 1);
  const onCursor = useCallback((chart: uPlot) => { if (chart.cursor.idx != null) setIndex(chart.cursor.idx); }, []);
  useEffect(() => {
    const target = holder.current;
    if (!target || data[0].length < 2) return;
    let disposed = false, observer: ResizeObserver | undefined;
    void import("uplot").then(({ default: Plot }) => {
      if (disposed) return;
      const chart = new Plot({ width: Math.max(220, target.clientWidth), height: 230,
        legend: { show: false }, select: { show: false, left: 0, top: 0, width: 0, height: 0 }, cursor: { drag: { x: false, y: false }, points: { show: true } },
        scales: { x: { time: true } },
        series: [{}, ...group.series.map((series, i) => ({ label: series.label, stroke: series.color, width: 1.6, spanGaps: false, dash: i > 0 && group.series[i - 1].color === series.color ? [5, 3] : [], points: { show: true, size: 3 } }))],
        axes: [
          { stroke: "#9daeb9", font: "10px Consolas, monospace", grid: { show: false }, size: 44, space: 115, values: (_chart, ticks) => ticks.map(value => axisTime.format(new Date(value * 1000))) },
          { stroke: "#9daeb9", font: "10px Consolas, monospace", size: 64, grid: { stroke: "#2a3943", dash: [3, 4], width: 1 }, values: (_chart, ticks) => ticks.map(value => historyValue(value, group.unit)) },
        ], hooks: { setCursor: [onCursor] },
      }, data, target);
      plot.current = chart;
      observer = new ResizeObserver(entries => { const width = entries[0]?.contentRect.width; if (width && !disposed) chart.setSize({ width: Math.max(220, Math.floor(width)), height: 230 }); });
      observer.observe(target);
    }).catch(() => { if (!disposed) setUnavailable(true); });
    return () => { disposed = true; observer?.disconnect(); plot.current?.destroy(); plot.current = null; };
  }, [data, group, onCursor]);
  const observed = group.series.some(series => series.points.some(point => point.value !== null));
  const selectedTime = data[0][current];
  return <div className="history-chart">
    {data[0].length >= 2 && observed && !unavailable ? <div className="history-canvas" ref={holder} aria-hidden="true" /> : <p className="panel-empty">{!observed ? "Sem amostras nesta janela." : data[0].length < 2 ? "Amostra única disponível; valores abaixo." : "Gráfico indisponível. Os valores continuam disponíveis abaixo."}</p>}
    {data[0].length > 0 && <div className="history-point-reader"><label htmlFor={pointId}>Consultar amostra · toque ou teclado</label><input id={pointId} type="range" min={0} max={data[0].length - 1} value={Math.max(0, current)} onChange={event => setIndex(Number(event.target.value))} aria-valuetext={timestamp(new Date(selectedTime * 1000).toISOString())} />
      <div className="history-tooltip" aria-live="polite" aria-atomic="true"><time dateTime={new Date(selectedTime * 1000).toISOString()}>{timestamp(new Date(selectedTime * 1000).toISOString())} · Fortaleza</time><dl>{group.series.map((series, i) => {
        const point = series.points.find(value => Date.parse(value.timestamp) / 1000 === selectedTime);
        return <div key={series.key}><dt><i style={{ background: series.color }} />{series.label}</dt><dd>{historyValue(data[i + 1][current], group.unit)}{point?.value != null && (point.min != null || point.max != null) && <small>Mín. {historyValue(point.min, group.unit)} · Máx. {historyValue(point.max, group.unit)}</small>}</dd></div>;
      })}</dl></div>
    </div>}
  </div>;
}
