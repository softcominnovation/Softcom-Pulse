import {
  signalInboxAgeLimitSeconds, signalOutboxAgeLimitSeconds, signalStates,
} from "../../config/signal-targets.ts";
import { pipelineNumbers, sanitizeSignalChecks } from "./sanitize.ts";

export type SignalHttpError = "timeout" | "network" | "tls" | "dns" | "http";
export type SignalHttpResult =
  | { ok: true; status: number; latencyMs: number; body: unknown }
  | { ok: false; error: SignalHttpError; status: number | null; latencyMs: number | null; body?: unknown };

export type SignalClassification = {
  state: number;
  latencyMs: number | null;
  httpStatus: number | null;
  liveOk: boolean | null;
  readyStatus: "ok" | "degraded" | "unknown" | null;
  workerStatus: string | null;
  activeInstances: number | null;
  outboxPending: number | null;
  inboxPending: number | null;
  outboxDead: number | null;
  inboxDead: number | null;
  oldestOutboxSeconds: number | null;
  oldestInboxSeconds: number | null;
  checks: Record<string, unknown> | null;
};

function depDown(value: unknown) {
  if (value === "down" || value === "unavailable") return true;
  if (value && typeof value === "object" && "status" in value) {
    const status = (value as { status?: string }).status;
    return status === "down" || status === "unavailable";
  }
  return false;
}
function knowledgeAttention(value: unknown) {
  if (value === "unavailable") return true;
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const row = value as Record<string, unknown>;
  return [row.itemsFailed, row.jobsFailedCurrent, row.expiredLeases, row.itemsWithoutActiveJob].some(n => typeof n === "number" && n > 0);
}

export function classifySignalSample(live: SignalHttpResult, ready: SignalHttpResult): SignalClassification {
  const latencyMs = [live.latencyMs, ready.latencyMs].filter((value): value is number => value !== null).reduce((a, b) => Math.max(a, b), 0) || null;
  const liveOk = live.ok && live.status === 200 && !!(live.body && typeof live.body === "object" && (live.body as { status?: string }).status === "ok");
  const readyBody = ready.ok || (!ready.ok && ready.error === "http") ? ready.body : undefined;
  const readyRecord = readyBody && typeof readyBody === "object" ? readyBody as Record<string, unknown> : null;
  const checks = sanitizeSignalChecks(readyRecord?.checks);
  const pipe = pipelineNumbers(checks);
  const worker = checks?.worker && typeof checks.worker === "object" ? checks.worker as Record<string, unknown> : null;
  const workerStatus = typeof worker?.status === "string" ? worker.status.slice(0, 32) : null;
  const activeInstances = typeof worker?.activeInstances === "number" ? worker.activeInstances : null;
  const readyStatusRaw = typeof readyRecord?.status === "string" ? readyRecord.status : null;
  const readyStatus: SignalClassification["readyStatus"] =
    readyStatusRaw === "ok" || readyStatusRaw === "degraded" ? readyStatusRaw : ready.ok ? "unknown" : null;
  const httpStatus = ready.status ?? live.status;

  const base: Omit<SignalClassification, "state"> = {
    latencyMs, httpStatus, liveOk: live.ok || (!live.ok && live.error === "http") ? liveOk : null, readyStatus, workerStatus, activeInstances,
    ...pipe, checks,
  };

  if (!live.ok && !ready.ok) return { ...base, state: signalStates.down, liveOk: false, readyStatus: null };
  if (!ready.ok && ready.error !== "http") return { ...base, state: signalStates.down };
  if (ready.status !== null && ready.status !== 200 && ready.status !== 503) return { ...base, state: signalStates.down };

  const depBad = !!(checks && (
    depDown(checks.database) || depDown(checks.redis) || depDown(checks.objectStorage) || depDown(checks.workdeskAudio)
  ));
  const workerBad = workerStatus === "stale" || workerStatus === "missing" || workerStatus === "unavailable";
  const ageBad = (pipe.oldestOutboxSeconds ?? 0) >= signalOutboxAgeLimitSeconds
    || (pipe.oldestInboxSeconds ?? 0) >= signalInboxAgeLimitSeconds;
  const degraded = ready.status === 503 || readyStatus === "degraded" || depBad || workerBad || ageBad;
  if (degraded) return { ...base, state: signalStates.degraded };

  const deadOnly = ((pipe.outboxDead ?? 0) > 0 || (pipe.inboxDead ?? 0) > 0) && readyStatus === "ok" && !depBad && !workerBad && !ageBad;
  const knowledgeSoft = knowledgeAttention(checks?.knowledgeIndex);
  if (deadOnly || knowledgeSoft) return { ...base, state: signalStates.attention };

  if (ready.status === 200 && readyStatus === "ok" && workerStatus === "up" && liveOk !== false) {
    return { ...base, state: signalStates.ok };
  }
  if (readyStatus === "ok") return { ...base, state: signalStates.attention };
  return { ...base, state: signalStates.degraded };
}
