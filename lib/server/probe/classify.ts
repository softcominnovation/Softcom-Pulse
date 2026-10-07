import { probeDefaultTimeoutMs, probeReasons, probeSlowAfterMs } from "../../config/external-services.ts";

export type ProbeObservation = { status?: number; body?: string; latencyMs?: number; error?: "timeout" | "network" | "tls" };
export function pointerValue(value: unknown, pointer: string) {
  let current = value;
  for (const part of pointer.split("/").slice(1).map(item => item.replaceAll("~1", "/").replaceAll("~0", "~"))) {
    if (Array.isArray(current)) current = current[part === "0" || /^[1-9]\d*$/.test(part) ? Number(part) : -1];
    else if (current !== null && typeof current === "object" && Object.hasOwn(current, part)) current = (current as Record<string, unknown>)[part];
    else return undefined;
  }
  return current;
}
export function classifyProbe(mode: "http_status" | "json_match", statuses: number[], pointer: string | null, expected: string | null, observation: ProbeObservation, timeoutMs = probeDefaultTimeoutMs) {
  if (observation.error === "timeout") return { reason: probeReasons.timeout, latencyMs: null, httpStatus: null };
  if (observation.error === "tls") return { reason: probeReasons.tls, latencyMs: null, httpStatus: null };
  if (observation.error === "network" || observation.status === undefined || observation.latencyMs === undefined) return { reason: probeReasons.network, latencyMs: null, httpStatus: null };
  const latencyMs = observation.latencyMs, httpStatus = observation.status;
  if (httpStatus === 401 || httpStatus === 403) return { reason: probeReasons.unauthorized, latencyMs, httpStatus };
  if (!statuses.includes(httpStatus)) return { reason: probeReasons.status, latencyMs, httpStatus };
  if (mode === "json_match") {
    let parsed: unknown;
    try { parsed = JSON.parse(observation.body ?? ""); } catch { return { reason: probeReasons.json, latencyMs, httpStatus }; }
    if (pointer === null || expected === null || JSON.stringify(pointerValue(parsed, pointer)) !== expected) return { reason: probeReasons.json, latencyMs, httpStatus };
  }
  return { reason: latencyMs > probeSlowAfterMs(timeoutMs) ? probeReasons.slow : probeReasons.ok, latencyMs, httpStatus };
}
