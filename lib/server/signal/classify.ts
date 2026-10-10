import { signalDefaultTimeoutMs, signalStates } from "../../config/signal-targets.ts";
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

/** Same half-timeout rule as external application probes. */
export function signalSlowAfterMs(timeoutMs: number) {
  return Math.max(1, Math.floor(timeoutMs / 2));
}

/**
 * Availability like applications: responds = Disponível; slow (above half timeout) = Atenção;
 * no useful response = Indisponível. Pipeline/DLQ/deps stay in metrics, not in the state badge.
 */
export function classifySignalSample(
  live: SignalHttpResult,
  ready: SignalHttpResult,
  timeoutMs = signalDefaultTimeoutMs,
): SignalClassification {
  const latencyMs = [live.latencyMs, ready.latencyMs]
    .filter((value): value is number => value !== null)
    .reduce((a, b) => Math.max(a, b), 0) || null;
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

  const timedOut = (!live.ok && live.error === "timeout") || (!ready.ok && ready.error === "timeout");
  const noResponse = timedOut
    || (!live.ok && !ready.ok)
    || (!ready.ok && ready.error !== "http")
    || (ready.status !== null && ready.status !== 200 && ready.status !== 503);

  if (noResponse) return { ...base, state: signalStates.down, liveOk: timedOut || !live.ok ? false : base.liveOk, readyStatus: timedOut ? null : base.readyStatus };

  const responded = ready.status === 200 || ready.status === 503 || ready.ok;
  if (!responded) return { ...base, state: signalStates.down };

  if (latencyMs !== null && latencyMs > signalSlowAfterMs(timeoutMs)) {
    return { ...base, state: signalStates.attention };
  }
  return { ...base, state: signalStates.ok };
}
