import "server-only";
import { signalHealthLivePath, signalHealthReadyPath } from "../../config/signal-targets.ts";
import type { SignalHttpError, SignalHttpResult } from "./classify.ts";

function classifyError(error: unknown): SignalHttpError {
  const code = error && typeof error === "object" && "code" in error ? String((error as { code?: string }).code) : "";
  const name = error instanceof Error ? error.name : "";
  if (name === "AbortError" || code === "ABORT_ERR" || code === "UND_ERR_ABORTED") return "timeout";
  if (code === "ENOTFOUND" || code === "EAI_AGAIN") return "dns";
  if (code === "CERT_HAS_EXPIRED" || code === "UNABLE_TO_VERIFY_LEAF_SIGNATURE" || code === "ERR_TLS_CERT_ALTNAME_INVALID") return "tls";
  return "network";
}

export async function signalExchange(url: string, timeoutMs: number, signal?: AbortSignal): Promise<SignalHttpResult> {
  const started = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const onAbort = () => controller.abort();
  signal?.addEventListener("abort", onAbort, { once: true });
  try {
    const response = await fetch(url, {
      method: "GET",
      redirect: "manual",
      signal: controller.signal,
      headers: { accept: "application/json" },
    });
    const latencyMs = Math.max(0, Date.now() - started);
    if (response.status >= 300 && response.status < 400) {
      return { ok: false, error: "http", status: response.status, latencyMs };
    }
    let body: unknown = null;
    const text = await response.text();
    if (text) {
      try { body = JSON.parse(text); }
      catch { body = null; }
    }
    if (response.status === 200) return { ok: true, status: 200, latencyMs, body };
    return { ok: false, error: "http", status: response.status, latencyMs, body };
  } catch (error) {
    return { ok: false, error: classifyError(error), status: null, latencyMs: Math.max(0, Date.now() - started) };
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", onAbort);
  }
}

export async function consultSignalTarget(baseUrl: string, timeoutMs: number, signal?: AbortSignal) {
  const livePath = signalHealthLivePath();
  const readyPath = signalHealthReadyPath();
  if (!livePath || !readyPath) {
    return {
      live: { ok: false as const, error: "network" as const, status: null, latencyMs: null },
      ready: { ok: false as const, error: "network" as const, status: null, latencyMs: null },
    };
  }
  const live = await signalExchange(`${baseUrl}${livePath}`, timeoutMs, signal);
  const ready = await signalExchange(`${baseUrl}${readyPath}`, timeoutMs, signal);
  return { live, ready };
}
