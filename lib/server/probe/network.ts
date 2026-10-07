import "server-only";
import { lookup } from "node:dns/promises";
import { BlockList, isIP } from "node:net";
import tls from "node:tls";
import { probeTimeoutMs } from "../../config/external-services.ts";
import { BffError } from "../bff.ts";

const blocked = new BlockList();
blocked.addSubnet("127.0.0.0", 8, "ipv4");
blocked.addAddress("0.0.0.0", "ipv4");
blocked.addSubnet("169.254.0.0", 16, "ipv4");
blocked.addSubnet("224.0.0.0", 4, "ipv4");
blocked.addAddress("::", "ipv6");
blocked.addAddress("::1", "ipv6");
blocked.addSubnet("fe80::", 10, "ipv6");
blocked.addSubnet("ff00::", 8, "ipv6");

export function isBlockedAddress(address: string) {
  const mapped = address.toLowerCase().startsWith("::ffff:") ? address.slice(7) : address;
  if (isIP(mapped) === 4 && blocked.check(mapped, "ipv4")) return true;
  const family = isIP(address);
  if (family === 0) return false;
  return blocked.check(address, family === 6 ? "ipv6" : "ipv4");
}
function resolveProbeHosts(hostname: string, signal: AbortSignal) {
  const pending = lookup(hostname, { all: true, verbatim: true });
  return new Promise<Awaited<typeof pending>>((resolve, reject) => {
    const abort = () => reject(Object.assign(new Error("timeout"), { code: "ETIMEDOUT" }));
    if (signal.aborted) { abort(); return; }
    signal.addEventListener("abort", abort, { once: true });
    pending.then(value => { signal.removeEventListener("abort", abort); resolve(value); }, error => { signal.removeEventListener("abort", abort); reject(error); });
  });
}
export async function assertProbeDestination(value: string) {
  const url = parseProbeUrl(value);
  const hostname = url.hostname.replace(/^\[|\]$/g, "");
  if (isIP(hostname)) return url;
  try {
    const addresses = await resolveProbeHosts(hostname, AbortSignal.timeout(probeTimeoutMs));
    if (addresses.length === 0 || addresses.some(item => isBlockedAddress(item.address))) throw new Error("blocked");
  } catch (error) { if (error instanceof BffError) throw error; throw new BffError(400, "invalid_request"); }
  return url;
}
export function parseProbeUrl(value: string) {
  let url: URL;
  try { url = new URL(value); } catch { throw new BffError(400, "invalid_request"); }
  const hostname = url.hostname.replace(/^\[|\]$/g, "");
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash || hostname.length > 253 || hostname.toLowerCase() === "localhost" || isBlockedAddress(hostname)) throw new BffError(400, "invalid_request");
  return url;
}
export type ProbeExchange = { status: number; body: string; latencyMs: number; certNotAfter: string | null };
export async function probeExchange(url: URL, method: string, headers: Record<string, string>, body: string | undefined, timeoutMs: number, signal?: AbortSignal): Promise<ProbeExchange> {
  const hostname = url.hostname.replace(/^\[|\]$/g, "");
  const lookupSignal = AbortSignal.any([AbortSignal.timeout(timeoutMs), ...(signal ? [signal] : [])]);
  const addresses = isIP(hostname) ? [{ address: hostname }] : await resolveProbeHosts(hostname, lookupSignal);
  if (addresses.length === 0 || addresses.some(item => isBlockedAddress(item.address))) throw Object.assign(new Error("blocked"), { code: "EBLOCKED" });
  const started = Date.now();
  const port = Number(url.port || 443);
  const socket = tls.connect({ host: addresses[0].address, servername: hostname, port, timeout: timeoutMs });
  const abort = () => socket.destroy();
  signal?.addEventListener("abort", abort, { once: true });
  try {
    await new Promise<void>((resolve, reject) => {
      socket.once("secureConnect", () => resolve());
      socket.once("error", reject);
      socket.once("timeout", () => reject(Object.assign(new Error("timeout"), { code: "ETIMEDOUT" })));
    });
    const payload = [`${method} ${url.pathname || "/"} HTTP/1.1`, `Host: ${url.host}`, "Connection: close", ...Object.entries(headers).map(([name, value]) => `${name}: ${value}`)];
    if (body !== undefined) payload.push(`Content-Length: ${Buffer.byteLength(body)}`, "Content-Type: application/json");
    socket.write(payload.join("\r\n") + "\r\n\r\n" + (body ?? ""));
    const raw = await readLimited(socket, timeoutMs, started);
    const split = raw.indexOf("\r\n\r\n");
    if (split < 0) throw Object.assign(new Error("headers"), { code: "ECONNRESET" });
    const status = Number(/^HTTP\/1\.[01] (\d{3})/.exec(raw.subarray(0, split).toString("latin1"))?.[1]);
    if (!Number.isInteger(status)) throw Object.assign(new Error("status"), { code: "ECONNRESET" });
    const certificate = socket.getPeerCertificate();
    const expiry = certificate && "valid_to" in certificate ? Date.parse(certificate.valid_to) : Number.NaN;
    return { status, body: raw.subarray(split + 4, split + 4 + 8192).toString("utf8"), latencyMs: Date.now() - started, certNotAfter: Number.isNaN(expiry) ? null : new Date(expiry).toISOString() };
  } finally {
    signal?.removeEventListener("abort", abort);
    socket.destroy();
  }
}
function readLimited(socket: tls.TLSSocket, timeoutMs: number, started: number) {
  return new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0, settled = false;
    const fail = (error: Error) => { if (settled) return; settled = true; socket.destroy(); reject(error); };
    const finish = (value: Buffer) => { if (settled) return; settled = true; socket.destroy(); resolve(value); };
    socket.on("data", chunk => {
      chunks.push(chunk); size += chunk.length;
      const joined = Buffer.concat(chunks);
      const split = joined.indexOf("\r\n\r\n");
      if (split >= 0 && joined.length >= split + 4 + 8192) finish(joined.subarray(0, split + 4 + 8192));
      if (size > 32768 && split < 0) fail(Object.assign(new Error("headers"), { code: "ECONNRESET" }));
    });
    socket.once("end", () => finish(Buffer.concat(chunks)));
    socket.once("error", fail);
    socket.once("timeout", () => fail(Object.assign(new Error("timeout"), { code: "ETIMEDOUT" })));
    socket.setTimeout(Math.max(1, timeoutMs - (Date.now() - started)));
  });
}
