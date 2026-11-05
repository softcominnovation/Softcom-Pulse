// Shared spacing for the monitor's 148/168px cards, including 160% block fonts.
// Column counts, history strips and zoom are not changed.
export function monitorMinicardLayout(percent: number, expanded: boolean) {
  const factor = percent / 100;
  const round = (value: number) => Number(value.toFixed(4));
  return {
    padding: round(expanded ? Math.max(6, 10 - (factor - 1) * 7) : Math.max(4, 8 - (factor - 1) * 7)),
    nameLine: round(Math.max(expanded ? 20 : 17, (expanded ? 15 : 13) * factor * 1.05)),
    textLine: round(Math.max(expanded ? 14 : 13, (expanded ? 11 : 10) * factor * 1.05)),
    percentageSize: round((expanded ? 14.3 : 13) * factor),
    // Keep the approved line boxes and spacing when enlarging only the glyphs.
    percentageLine: round(Math.max(expanded ? 14 : 13, (expanded ? 13.2 : 12) * factor * 1.1)),
    footerPadding: 2,
  };
}

export function monitorMinicardVariables(percent: number) {
  return Object.fromEntries(([false, true] as const).flatMap(expanded =>
    Object.entries(monitorMinicardLayout(percent, expanded)).map(([key, value]) =>
      [`--monitor-${expanded ? 'expanded' : 'compact'}-${key}`, value + 'px']),
  ));
}

export function compatibleMinicardLayout(percent: number) {
  return [false, true].map(expanded => {
    const fit = monitorMinicardLayout(percent, expanded);
    const scope = `[data-monitor-font-scale="${percent}"] .availability-grid[data-card-size="${expanded ? 'expanded' : 'compact'}"]`;
    return `${scope} .availability-card{display:flex;flex-direction:column;gap:2px;padding-top:${fit.padding}px;padding-bottom:${fit.padding}px}` +
      `${scope} .availability-card > *{flex-shrink:0}` +
      `${scope} .availability-name{line-height:${fit.nameLine}px}` +
      `${scope} .availability-description{margin:0;line-height:${fit.textLine}px}` +
      `${scope} .status-pill,${scope} .availability-footer,${scope} .availability-footer strong,${scope} .reading,${scope} .reading > span:first-child,${scope} .reading > strong{line-height:${fit.textLine}px}` +
      `${scope} .availability-content{margin-top:auto;min-height:0;width:100%}` +
      `${scope} .mini-metrics > .reading{padding-top:0;padding-bottom:0}` +
      `${scope} .mini-metrics[data-metric-count="3"] > .reading:first-child{padding-bottom:6px}` +
      `${scope} .reading[data-usage-percent] > strong{font-size:${fit.percentageSize}px;line-height:${fit.percentageLine}px;font-weight:600}` +
      `${scope} .availability-content .metric-meter{margin-top:1px}` +
      `${scope} .availability-footer{padding-top:${fit.footerPadding}px;margin-top:0}`;
  }).join('');
}
