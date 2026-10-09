import test from "node:test";
import assert from "node:assert/strict";
import { downsampleProbeHistoryPoints, probeHistoryChartMaxPoints } from "../lib/probe/history.ts";

test("history downsampling keeps short series intact and caps dense series", () => {
  const short = Array.from({ length: 3 }, (_, index) => ({ n: index }));
  assert.deepEqual(downsampleProbeHistoryPoints(short), short);
  const dense = Array.from({ length: 1440 }, (_, index) => ({ n: index }));
  const chart = downsampleProbeHistoryPoints(dense);
  assert.ok(chart.length <= probeHistoryChartMaxPoints);
  assert.equal(chart[0].n, 0);
  assert.equal(chart.at(-1).n, 1439);
  assert.equal(new Set(chart.map(point => point.n)).size, chart.length);
});
