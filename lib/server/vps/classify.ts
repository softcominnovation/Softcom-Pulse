import { vpsMonitorReasons } from "../../config/standalone-vps.ts";
import type { MonitorExchange } from "./exchange.ts";
import { parseMonitorStatus, type MonitorReading } from "./status.ts";

export type VpsCheck = { reason: number; latencyMs: number | null; reading: MonitorReading | null };

function failed(reason: number, latencyMs: number | null): VpsCheck {
  return { reason, latencyMs, reading: null };
}
function httpReason(status: number) {
  if (status === 401 || status === 403) return vpsMonitorReasons.unauthorized;
  if (status < 200 || status >= 300) return vpsMonitorReasons.status;
  return null;
}

export function classifyVpsCheck(ping: MonitorExchange, status: MonitorExchange | null, timeoutMs: number): VpsCheck {
  if ("error" in ping) return failed(vpsMonitorReasons.timeout, null);
  const pingReason = httpReason(ping.status);
  if (pingReason !== null) return failed(pingReason, ping.latencyMs);
  if (!status || "error" in status) return failed(vpsMonitorReasons.timeout, ping.latencyMs);
  const statusReason = httpReason(status.status);
  if (statusReason !== null) return failed(statusReason, ping.latencyMs);
  const reading = parseMonitorStatus(status.body);
  if (!reading.usable) return { reason: vpsMonitorReasons.json, latencyMs: ping.latencyMs, reading };
  const slow = ping.latencyMs > Math.floor(timeoutMs / 2);
  return { reason: slow ? vpsMonitorReasons.slow : vpsMonitorReasons.ok, latencyMs: ping.latencyMs, reading };
}
