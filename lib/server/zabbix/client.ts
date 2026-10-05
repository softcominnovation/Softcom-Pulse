import "server-only";
import axios from "axios";
import { BffError } from "../bff.ts";
import type { Rpc } from "./types.ts";

const methods = new Set(["apiinfo.version", "host.get", "item.get", "problem.get", "trigger.get", "history.get", "trend.get", "template.get"]);
let requestId = 0;
let running = 0;
const waiters: (() => void)[] = [];

export const zabbixCall: Rpc = async <T>(method: string, params: Record<string, unknown>, signal?: AbortSignal): Promise<T> => {
  if (!methods.has(method)) throw new BffError(503, "zabbix_method_forbidden");
  let endpoint: URL;
  try {
    endpoint = new URL(process.env.ZABBIX_API_URL ?? "");
    if (!['https:', 'http:'].includes(endpoint.protocol) || endpoint.username || endpoint.password || !process.env.ZABBIX_API_TOKEN?.trim()) throw new Error();
  } catch { throw new BffError(503, "zabbix_configuration_missing"); }
  const deadline = signal ? AbortSignal.any([signal, AbortSignal.timeout(12000)]) : AbortSignal.timeout(12000);
  if (deadline.aborted) throw new BffError(503, "zabbix_cancelled");
  if (running >= 3) {
    if (waiters.length >= 24) throw new BffError(503, "zabbix_busy");
    await new Promise<void>((resolve, reject) => {
      const grant = () => { deadline.removeEventListener("abort", cancel); resolve(); };
      const cancel = () => { const index = waiters.indexOf(grant); if (index >= 0) waiters.splice(index, 1); reject(new BffError(503, "zabbix_cancelled")); };
      waiters.push(grant); deadline.addEventListener("abort", cancel, { once: true });
    });
  } else running++;
  try {
    if (deadline.aborted) throw new BffError(503, "zabbix_cancelled");
    const id = ++requestId;
    const response = await axios.post(endpoint.href, { jsonrpc: "2.0", method, params, id }, {
      headers: method === "apiinfo.version" ? {} : { Authorization: `Bearer ${process.env.ZABBIX_API_TOKEN}` },
      timeout: 10000, maxRedirects: 0, maxContentLength: 24 * 1024 * 1024, maxBodyLength: 2 * 1024 * 1024,
      signal: deadline,
    });
    const data = response.data;
    if (!data || data.jsonrpc !== "2.0" || data.id !== id || data.error || !("result" in data)) throw new BffError(503, "zabbix_response_invalid");
    return data.result as T;
  } catch (error) {
    if (error instanceof BffError) throw error;
    throw new BffError(503, "zabbix_unavailable");
  } finally {
    const next = waiters.shift();
    if (next) next(); else running--;
  }
};
