import "server-only";
import { probeConcurrency, probeTimeoutMs } from "../../config/external-services.ts";
import { BffError } from "../bff.ts";
import { classifyProbe, type ProbeObservation } from "./classify.ts";
import { probeExchange, parseProbeUrl, type ProbeExchange } from "./network.ts";
import { listEnabledExternalServices, purgeExternalSamples, recordExternalSample } from "./repository.ts";
import { openProbeSecret } from "./secret.ts";
import { publishProbeResult, publishProbeSync } from "./store.ts";

type ServiceRow = Awaited<ReturnType<typeof listEnabledExternalServices>>[number];
export type ProbeTransport = (url: URL, method: string, headers: Record<string, string>, body: string | undefined, timeoutMs: number, signal?: AbortSignal) => Promise<ProbeExchange>;

function observationError(error: unknown): ProbeObservation {
  const code = error && typeof error === "object" && "code" in error ? String(error.code) : "";
  if (code === "ETIMEDOUT" || code === "ABORT_ERR") return { error: "timeout" };
  if (/CERT|TLS|UNABLE_TO_VERIFY|ERR_TLS|EPROTO/.test(code + (error instanceof Error ? error.message : ""))) return { error: "tls" };
  return { error: "network" };
}
async function checkOne(service: ServiceRow, transport: ProbeTransport, signal?: AbortSignal) {
  const url = parseProbeUrl(service.url);
  let secret = "";
  if (service.secretCiphertext) secret = openProbeSecret(service.secretCiphertext);
  const headers: Record<string, string> = {};
  if (service.authMode === "header" && service.headerName) headers[service.headerName] = secret;
  const body = service.method === "POST" ? service.bodyTemplate?.replaceAll("{{secret}}", secret) : undefined;
  const started = new Date();
  let observation: ProbeObservation;
  let certNotAfter: string | null = null;
  try {
    const response = await transport(url, service.method, headers, body, probeTimeoutMs, signal);
    observation = { status: response.status, body: response.body, latencyMs: response.latencyMs };
    certNotAfter = response.certNotAfter;
  } catch (error) { observation = observationError(error); }
  const classified = classifyProbe(service.successMode, service.expectedStatuses, service.jsonPointer, service.expectedValue, observation);
  const stats = await recordExternalSample(service.id, started, classified.reason, classified.latencyMs, classified.httpStatus);
  await publishProbeResult(service.id, started.toISOString(), { ...classified, certNotAfter, ...stats });
}
export async function runProbeCycle(options: { signal?: AbortSignal; transport?: ProbeTransport; services?: ServiceRow[] } = {}) {
  const services = options.services ?? await listEnabledExternalServices();
  const transport = options.transport ?? probeExchange;
  let index = 0;
  const worker = async () => {
    while (index < services.length && !options.signal?.aborted) await checkOne(services[index++], transport, options.signal).catch(error => {
      if (error instanceof BffError && (error.code === "database_unavailable" || error.code === "cache_unavailable")) throw error;
    });
  };
  await Promise.all(Array.from({ length: Math.min(probeConcurrency, services.length) }, worker));
}
export async function runProbeMaintenance(signal: AbortSignal, lastPurge: number) {
  if (Date.now() - lastPurge < 24 * 60 * 60 * 1000) return lastPurge;
  await purgeExternalSamples(signal);
  return signal.aborted ? lastPurge : Date.now();
}
