import "server-only";
import { monitorEndpoint, vpsConcurrency } from "../../config/standalone-vps.ts";
import { BffError } from "../bff.ts";
import { classifyVpsCheck } from "./classify.ts";
import { monitorExchange, type MonitorExchange } from "./exchange.ts";
import { listEnabledMonitoredVps, purgeVpsSamples, recordVpsSample } from "./repository.ts";
import { openVpsMonitorKey } from "./secret.ts";
import { publishVpsResult } from "./store.ts";

type Transport = (url: string, apiKey: string, timeoutMs: number, signal?: AbortSignal) => Promise<MonitorExchange>;
type Target = { id: string; baseUrl: string | null; apiKeyCiphertext: string | null; timeoutMs: number };

async function consult(target: Target, transport: Transport, signal?: AbortSignal) {
  if (!target.baseUrl || !target.apiKeyCiphertext) return;
  const apiKey = openVpsMonitorKey(target.apiKeyCiphertext);
  const call = async (path: "/ping/latency" | "/status") => {
    try { return await transport(monitorEndpoint(target.baseUrl!, path), apiKey, target.timeoutMs, signal); }
    catch { return { error: "network" as const }; }
  };
  const ping = await call("/ping/latency");
  const accepted = !("error" in ping) && ping.status >= 200 && ping.status < 300;
  const status = accepted ? await call("/status") : null;
  const check = classifyVpsCheck(ping, status, target.timeoutMs);
  const checkedAt = new Date();
  await recordVpsSample(target.id, checkedAt, check.reason, check.latencyMs, check.reading?.cpuPercent ?? null, check.reading?.memoryPercent ?? null, check.reading?.diskPercent ?? null);
  await publishVpsResult(target.id, checkedAt.toISOString(), check.reason, check.latencyMs, check.reading).catch(() => undefined);
}

export async function runVpsMonitorCycle(options: { signal?: AbortSignal; transport?: Transport; targets?: Target[] } = {}) {
  const targets = options.targets ?? await listEnabledMonitoredVps();
  const transport = options.transport ?? monitorExchange;
  let index = 0;
  const worker = async () => {
    while (index < targets.length && !options.signal?.aborted) {
      const target = targets[index++];
      if (!target) break;
      await consult(target, transport, options.signal).catch(error => {
        if (error instanceof BffError && (error.code === "database_unavailable" || error.code === "cache_unavailable")) throw error;
      });
    }
  };
  await Promise.all(Array.from({ length: Math.min(vpsConcurrency, targets.length) }, worker));
  if (!options.signal?.aborted) await purgeVpsSamples(options.signal ?? new AbortController().signal);
}
