/** Max latency samples returned to the browser for the chart. Summary stays full-window accurate. */
export const probeHistoryChartMaxPoints = 360;

/** Evenly pick chart samples so 24h/7d/30d stay under the payload budget. */
export function downsampleProbeHistoryPoints<T>(points: readonly T[], maxPoints = probeHistoryChartMaxPoints): T[] {
  if (points.length <= maxPoints) return points.slice();
  if (maxPoints <= 1) return points.slice(-1);
  const last = points.length - 1;
  const out: T[] = [];
  let previous = -1;
  for (let index = 0; index < maxPoints; index++) {
    const at = Math.round((index * last) / (maxPoints - 1));
    if (at === previous) continue;
    out.push(points[at]!);
    previous = at;
  }
  return out;
}
