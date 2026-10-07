import { test } from "node:test";
import assert from "node:assert/strict";
import { certRemainingDays, formatUptime, probeStatus, sortProbeCards, uptimePercent } from "../lib/probe/status.ts";

const card = (name, reason, uptime) => ({
  id: name, displayName: name, description: null, serviceType: null, displayOrder: 0, critical: false, dashboardEnabled: true,
  reason, latencyMs: null, checkedAt: null, httpStatus: null, certNotAfter: null, uptime24h: uptime, strip: [],
});
test("probe labels, 24h availability and sort keep missing samples at the end", () => {
  assert.equal(probeStatus(0).label, "Disponível");
  assert.equal(probeStatus(1).label, "Lento");
  assert.equal(probeStatus(2).label, "Falha na consulta");
  assert.equal(probeStatus(5).label, "Indisponível");
  assert.equal(probeStatus(null).label, "Sem dados");
  assert.equal(formatUptime({ available: 1, total: 3 }), "33,3%");
  assert.equal(formatUptime({ available: 0, total: 0 }), "—");
  assert.equal(formatUptime(null), "—");
  assert.equal(uptimePercent({ available: 2, total: 2 }), 100);
  const items = [card("Beta", 2, { available: 0, total: 4 }), card("Alfa", 0, { available: 1, total: 1 }), card("Sem amostra", null, null)];
  assert.deepEqual(sortProbeCards(items, "uptime", "desc").map(item => item.displayName), ["Alfa", "Beta", "Sem amostra"]);
  assert.deepEqual(sortProbeCards(items, "state", "asc").map(item => item.displayName), ["Alfa", "Beta", "Sem amostra"]);
  assert.deepEqual(sortProbeCards(items, "name", "asc").map(item => item.displayName), ["Alfa", "Beta", "Sem amostra"]);
  assert.equal(certRemainingDays("2099-01-01T00:00:00.000Z", Date.parse("2098-12-31T00:00:00.000Z")), 1);
});
