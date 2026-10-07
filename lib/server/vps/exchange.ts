import "server-only";

export type MonitorExchange = { status: number; body: string; latencyMs: number } | { error: "timeout" | "network" };
const bodyLimit = 64 * 1024;

async function readLimited(response: Response) {
  const reader = response.body?.getReader();
  if (!reader) return "";
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (size < bodyLimit) {
    const { done, value } = await reader.read();
    if (done || !value) break;
    const room = bodyLimit - size;
    chunks.push(value.byteLength > room ? value.subarray(0, room) : value);
    size += Math.min(value.byteLength, room);
    if (value.byteLength > room) break;
  }
  await reader.cancel().catch(() => undefined);
  return Buffer.concat(chunks).toString("utf8");
}

export async function monitorExchange(url: string, apiKey: string, timeoutMs: number, signal?: AbortSignal): Promise<MonitorExchange> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const stop = () => controller.abort();
  signal?.addEventListener("abort", stop);
  const started = Date.now();
  try {
    const response = await fetch(url, { method: "GET", redirect: "manual", cache: "no-store", headers: { "x-api-key": apiKey }, signal: controller.signal });
    const body = await readLimited(response);
    return { status: response.status, body: response.status >= 300 && response.status < 400 ? "" : body, latencyMs: Date.now() - started };
  } catch {
    return { error: signal?.aborted ? "network" : controller.signal.aborted ? "timeout" : "network" };
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", stop);
  }
}
