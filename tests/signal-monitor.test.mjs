import test from "node:test";
import assert from "node:assert/strict";
import {
  signalApiBaseUrl, signalBaseUrl, signalHealthLivePath, signalHealthPath, signalHealthReadyPath,
  signalMonitorConfigurationOk, signalMonitorIntervalMs, signalStates, signalTargetWriteSchema,
} from "../lib/config/signal-targets.ts";
import { classifySignalSample } from "../lib/server/signal/classify.ts";
import { sanitizeSignalChecks } from "../lib/server/signal/sanitize.ts";

test("Signal monitor interval is 60s unless a value from 30s to 120s is set", () => {
  assert.equal(signalMonitorIntervalMs(undefined), 60000);
  assert.equal(signalMonitorIntervalMs(""), 60000);
  assert.equal(signalMonitorIntervalMs("30000"), 30000);
  assert.equal(signalMonitorIntervalMs("120000"), 120000);
  for (const value of ["29999", "120001", "60000.5", "60s"]) assert.equal(signalMonitorIntervalMs(value), null, value);
});

test("Signal API base URL and health paths are env-configurable with safe defaults", () => {
  assert.equal(signalApiBaseUrl(undefined), undefined);
  assert.equal(signalApiBaseUrl(""), undefined);
  assert.equal(signalApiBaseUrl("https://api-signal-squad-ia-01.hostsoftcom.cloud/"), "https://api-signal-squad-ia-01.hostsoftcom.cloud");
  assert.equal(signalApiBaseUrl("https://user:secret@api.example"), null);
  assert.equal(signalHealthLivePath(undefined), "/health/live");
  assert.equal(signalHealthReadyPath(""), "/health/ready");
  assert.equal(signalHealthPath("/health/live/", "/health/live"), "/health/live");
  assert.equal(signalHealthPath("/ready/v2", "/health/ready"), "/ready/v2");
  for (const path of ["health/live", "/health?x=1", "/health#x", "/../etc", "//evil", "\\health"]) {
    assert.equal(signalHealthPath(path, "/health/live"), null, path);
  }
  const previous = {
    SIGNAL_API_BASE_URL: process.env.SIGNAL_API_BASE_URL,
    SIGNAL_HEALTH_LIVE_PATH: process.env.SIGNAL_HEALTH_LIVE_PATH,
    SIGNAL_HEALTH_READY_PATH: process.env.SIGNAL_HEALTH_READY_PATH,
    SIGNAL_MONITOR_INTERVAL_MS: process.env.SIGNAL_MONITOR_INTERVAL_MS,
  };
  try {
    process.env.SIGNAL_MONITOR_INTERVAL_MS = "60000";
    delete process.env.SIGNAL_API_BASE_URL;
    delete process.env.SIGNAL_HEALTH_LIVE_PATH;
    delete process.env.SIGNAL_HEALTH_READY_PATH;
    assert.equal(signalMonitorConfigurationOk(), true);
    process.env.SIGNAL_API_BASE_URL = "https://api-signal-squad-ia-01.hostsoftcom.cloud";
    assert.equal(signalMonitorConfigurationOk(), true);
    process.env.SIGNAL_API_BASE_URL = "https://user:x@bad.example";
    assert.equal(signalMonitorConfigurationOk(), false);
    process.env.SIGNAL_API_BASE_URL = "https://api-signal-squad-ia-01.hostsoftcom.cloud";
    process.env.SIGNAL_HEALTH_LIVE_PATH = "/../nope";
    assert.equal(signalMonitorConfigurationOk(), false);
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test("Signal base URLs allow https (http on local) and reject userinfo, query and fragment", () => {
  assert.equal(signalBaseUrl("https://api-signal-squad-ia-01.hostsoftcom.cloud/"), "https://api-signal-squad-ia-01.hostsoftcom.cloud");
  assert.equal(signalBaseUrl("http://127.0.0.1:8080"), "http://127.0.0.1:8080");
  const saved = signalTargetWriteSchema.parse({ displayName: "Squad", baseUrl: "https://api-signal-squad-ia-01.hostsoftcom.cloud/" });
  assert.equal(saved.baseUrl, "https://api-signal-squad-ia-01.hostsoftcom.cloud");
  for (const baseUrl of [
    "http://user:secret@api.example/signal",
    "https://api.example/signal?token=secret",
    "https://api.example/signal#frag",
    "ftp://api.example/signal",
  ]) {
    assert.equal(signalBaseUrl(baseUrl), null, baseUrl);
    assert.throws(() => signalTargetWriteSchema.parse({ displayName: "X", baseUrl }), baseUrl);
  }
});

test("sanitize keeps known readiness checks and drops secrets", () => {
  const checks = sanitizeSignalChecks({
    database: "up",
    redis: { status: "up" },
    objectStorage: "down",
    workdeskAudio: { status: "up" },
    worker: { status: "up", lastHeartbeatAt: "2026-10-09T12:00:00.000Z", ageSeconds: 3, activeInstances: 2 },
    pipeline: { outbox_pending: 1, outbox_dead: 0, inbox_pending: 0, inbox_dead: 2, oldest_outbox_seconds: 10, oldest_inbox_seconds: 5 },
    knowledgeIndex: { itemsFailed: 0, jobsFailedCurrent: 0, expiredLeases: 0, itemsWithoutActiveJob: 0 },
    authorization: "Bearer secret",
    rawBody: "<html>",
  });
  assert.equal(checks.database, "up");
  assert.equal(checks.worker.status, "up");
  assert.equal(checks.pipeline.outbox_dead, 0);
  assert.equal(checks.authorization, undefined);
  assert.equal(checks.rawBody, undefined);
});

function okReady(checks = {}) {
  return {
    ok: true, status: 200, latencyMs: 40,
    body: { status: "ok", checks: {
      database: "up", redis: "up", objectStorage: "up", workdeskAudio: "up",
      worker: { status: "up", activeInstances: 1, ageSeconds: 2 },
      pipeline: { outbox_pending: 0, outbox_dead: 0, inbox_pending: 0, inbox_dead: 0, oldest_outbox_seconds: 0, oldest_inbox_seconds: 0 },
      knowledgeIndex: { itemsFailed: 0, jobsFailedCurrent: 0, expiredLeases: 0, itemsWithoutActiveJob: 0 },
      ...checks,
    } },
  };
}
const liveOk = { ok: true, status: 200, latencyMs: 20, body: { status: "ok" } };

test("Signal classifier maps ready ok, degraded, worker stale, DLQ-only, ages and timeout", () => {
  assert.equal(classifySignalSample(liveOk, okReady()).state, signalStates.ok);

  const degraded = classifySignalSample(liveOk, {
    ok: false, error: "http", status: 503, latencyMs: 30,
    body: { status: "degraded", checks: { database: "down", worker: { status: "unavailable" } } },
  });
  assert.equal(degraded.state, signalStates.degraded);

  assert.equal(classifySignalSample(liveOk, okReady({ worker: { status: "stale", ageSeconds: 50, activeInstances: 0 } })).state, signalStates.degraded);

  const dlq = classifySignalSample(liveOk, okReady({
    pipeline: { outbox_pending: 0, outbox_dead: 3, inbox_pending: 0, inbox_dead: 0, oldest_outbox_seconds: 0, oldest_inbox_seconds: 0 },
  }));
  assert.equal(dlq.state, signalStates.attention);

  assert.equal(classifySignalSample(liveOk, okReady({
    pipeline: { outbox_pending: 2, outbox_dead: 0, inbox_pending: 0, inbox_dead: 0, oldest_outbox_seconds: 60, oldest_inbox_seconds: 0 },
  })).state, signalStates.degraded);

  assert.equal(classifySignalSample(liveOk, okReady({
    pipeline: { outbox_pending: 0, outbox_dead: 0, inbox_pending: 1, inbox_dead: 0, oldest_outbox_seconds: 0, oldest_inbox_seconds: 120 },
  })).state, signalStates.degraded);

  const timeout = classifySignalSample(
    { ok: false, error: "timeout", status: null, latencyMs: 5000 },
    { ok: false, error: "timeout", status: null, latencyMs: 5000 },
  );
  assert.equal(timeout.state, signalStates.down);
});
