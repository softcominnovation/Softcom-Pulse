import test from "node:test";
import assert from "node:assert/strict";
import { blockCatalog, effectiveOptions, presentationDocumentSchema } from "../lib/config/presentation.ts";
import { signalAttentionEvents } from "../lib/signal/events.ts";
import { signalStateColor, signalStateLabel, signalWorkersLabel } from "../lib/signal/labels.ts";
import { randomUUID } from "node:crypto";

test("signal_flow is available with visibleRows defaults and rejects inventing options", () => {
  assert.equal(blockCatalog.signal_flow.available, true);
  assert.equal(blockCatalog.signal_flow.label, "Signal · fluxo de processamento");
  assert.deepEqual(effectiveOptions({ type: "signal_flow" }), { visibleRows: 4 });
  assert.throws(() => effectiveOptions({ type: "signal_flow", options: { visibleRows: 2 } }));
  assert.throws(() => effectiveOptions({ type: "signal_flow", options: { jobs: 1284 } }));
  const document = {
    schemaVersion: 2, revision: 1, defaultTvMode: false, displayScalePercent: 110, showStatusBanner: false,
    idlePresentation: { enabled: false, afterMinutes: 5, requestFullscreen: true },
    rotation: { autoStart: false, intervalSeconds: 20 },
    screens: [{
      id: randomUUID(), name: "Visão geral", enabled: true, layout: "overview",
      blocks: [{ id: randomUUID(), type: "signal_flow", enabled: true, width: "wide", options: { visibleRows: 4 } }],
    }],
  };
  assert.equal(presentationDocumentSchema.safeParse(document).success, true);
});

test("signal labels and attention events stay honest about missing throughput", () => {
  assert.equal(signalStateLabel(0), "Disponível");
  assert.equal(signalStateLabel(3), "Indisponível");
  assert.equal(signalStateLabel(null), "Sem dados");
  assert.equal(signalStateColor(0), "#64d6b0");
  assert.equal(signalWorkersLabel(2, "2026-10-09T12:00:00.000Z"), "2 workers");
  assert.equal(signalWorkersLabel(null, null), "Sem evidência");
  const events = signalAttentionEvents({
    state: 2, readyStatus: "degraded", workerStatus: "stale",
    outboxPending: 1, inboxPending: 0, outboxDead: 2, inboxDead: 0,
    oldestOutboxSeconds: 90, oldestInboxSeconds: 10,
    checks: { database: "down", redis: "up", objectStorage: "up", workdeskAudio: "up", knowledgeIndex: { itemsFailed: 1 } },
  });
  assert.ok(events.some(item => item.id === "ready-degraded"));
  assert.ok(events.some(item => item.id === "worker"));
  assert.ok(events.some(item => item.id === "dlq"));
  assert.ok(events.some(item => item.id === "dep-database"));
  assert.ok(events.every(item => !/1\.?284|jobs\s*\/\s*30/i.test(item.text)));
});
