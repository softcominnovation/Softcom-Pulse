import "server-only";
import https from "node:https";
import { isIP } from "node:net";
import { isBlockedAddress, parseProbeUrl, resolveProbeHosts } from "../probe/network.ts";

export async function postWebhook(destination: string, key: string, eventId: string, body: string, shutdown: AbortSignal) {
  const signal = AbortSignal.any([shutdown, AbortSignal.timeout(5000)]);
  const url = parseProbeUrl(destination);
  const host = url.hostname.replace(/^\[|\]$/g, "");
  const addresses = isIP(host) ? [{ address: host, family: isIP(host) }] : await resolveProbeHosts(host, signal);
  if (!addresses.length || addresses.some(({ address }) => isBlockedAddress(address))) {
    throw Object.assign(new Error("blocked"), { code: "EBLOCKED" });
  }
  const address = addresses[0];
  // Keep the original hostname for Host, SNI and certificate verification. Never resolve it a second time.
  return new Promise<{ status: number; retryAfter?: string }>((resolve, reject) => {
    const req = https.request(url, {
      method: "POST", agent: false, signal, maxHeaderSize: 16384,
      lookup: (_hostname, options, callback) => {
        if (options.all) callback(null, [address]);
        else callback(null, address.address, address.family);
      },
      headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body), api_key: key, "Idempotency-Key": eventId },
    }, response => {
      resolve({ status: response.statusCode ?? 0, retryAfter: response.headers["retry-after"] });
      response.destroy();
    });
    req.once("error", reject);
    req.end(body);
  });
}

export function webhookRetryMs(attempt: number, retryAfter?: string) {
  const backoff = [15000, 60000, 300000, 900000][attempt - 1] ?? 900000;
  const serverDelay = retryAfter && /^\d+$/.test(retryAfter) ? Number(retryAfter) * 1000 : Date.parse(retryAfter ?? "") - Date.now();
  return Math.min(3600000, Math.max(Number.isNaN(serverDelay) ? 0 : serverDelay, Math.round(backoff * (1 + Math.random() / 10))));
}
