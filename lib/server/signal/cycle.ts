import "server-only";
import { signalConcurrency } from "../../config/signal-targets.ts";
import { BffError } from "../bff.ts";
import { classifySignalSample, type SignalHttpResult } from "./classify.ts";
import { consultSignalTarget } from "./exchange.ts";
import { ensureSignalTargetFromEnv, listEnabledSignalTargets, purgeSignalSamples, recordSignalSample } from "./repository.ts";
import { publishSignalSync } from "./store.ts";

type Target = { id: string; baseUrl: string; timeoutMs: number };
type Consult = (baseUrl: string, timeoutMs: number, signal?: AbortSignal) => Promise<{ live: SignalHttpResult; ready: SignalHttpResult }>;

async function consult(target: Target, transport: Consult, signal?: AbortSignal) {
  const { live, ready } = await transport(target.baseUrl, target.timeoutMs, signal);
  const classification = classifySignalSample(live, ready, target.timeoutMs);
  await recordSignalSample(target.id, new Date(), classification);
}

export async function runSignalMonitorCycle(options: {
  signal?: AbortSignal;
  transport?: Consult;
  targets?: Target[];
} = {}) {
  if (!options.targets) await ensureSignalTargetFromEnv();
  const targets = options.targets ?? await listEnabledSignalTargets();
  const transport = options.transport ?? consultSignalTarget;
  const attemptAt = new Date().toISOString();
  let index = 0;
  let failures = 0;
  const worker = async () => {
    while (index < targets.length && !options.signal?.aborted) {
      const target = targets[index++];
      if (!target) break;
      await consult(target, transport, options.signal).catch(error => {
        failures += 1;
        if (error instanceof BffError && (error.code === "database_unavailable" || error.code === "cache_unavailable")) throw error;
      });
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(signalConcurrency, targets.length || 1)) }, worker));
  if (!options.signal?.aborted) {
    await purgeSignalSamples(options.signal ?? new AbortController().signal).catch(() => undefined);
    const status = targets.length > 0 && failures === targets.length ? "failed" : "ok";
    await publishSignalSync(status, attemptAt, failures ? "target_failures" : null).catch(() => undefined);
  }
}
