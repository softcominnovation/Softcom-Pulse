import { z } from "zod";
import { hostKeySchema } from "./resources.ts";
import { vmKeySchema } from "./vms.ts";

const control = /[\u0000-\u001F\u007F]/;
const label = (max: number) => z.string().trim().min(1).max(max).refine(value => !control.test(value));
const optionalText = (max: number, missing: "null" | "keep") => z.string().trim().max(max).nullable().optional().transform((value, context) => {
  if (value === undefined) return missing === "null" ? null : undefined;
  if (value === null || value === "") return null;
  if (control.test(value)) { context.addIssue({ code: "custom", message: "Valor inválido." }); return z.NEVER; }
  return value;
});

export const signalStates = { ok: 0, attention: 1, degraded: 2, down: 3, no_data: 4 } as const;
export const signalDefaultTimeoutMs = 5000;
export const signalConcurrency = 4;
export const signalStripLength = 40;
export const signalTargetLimit = 10;
export const signalInfraLinkLimit = 20;
export const signalSampleRetentionMs = 30 * 24 * 60 * 60 * 1000;
export const signalResultTtlSeconds = 24 * 60 * 60;
export const signalHistoryRangeSchema = z.enum(["24h", "7d", "30d"]);
export const signalInfraRoles = ["manager", "worker", "admin", "other"] as const;
export const signalOutboxAgeLimitSeconds = 60;
export const signalInboxAgeLimitSeconds = 120;

export const signalDefaultLivePath = "/health/live";
export const signalDefaultReadyPath = "/health/ready";

export function signalMonitorIntervalMs(value = process.env.SIGNAL_MONITOR_INTERVAL_MS) {
  if (value === undefined || value.trim() === "") return 60000;
  if (!/^\d+$/.test(value)) return null;
  const interval = Number(value);
  return Number.isSafeInteger(interval) && interval >= 30000 && interval <= 120000 ? interval : null;
}

/** Public Signal API base URL: https (http only for local test hosts). No userinfo/query/fragment; strip trailing slash. */
export function signalBaseUrl(value: string, allowHttp = process.env.NODE_ENV !== "production") {
  let url: URL;
  try { url = new URL(value); } catch { return null; }
  const local = url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "::1";
  if (url.protocol === "http:") { if (!allowHttp && !local) return null; }
  else if (url.protocol !== "https:") return null;
  if (url.username || url.password || url.hash || url.search) return null;
  if (url.pathname.length > 1 && url.pathname.endsWith("/")) url.pathname = url.pathname.replace(/\/+$/, "");
  const href = url.href.endsWith("/") && url.pathname === "/" ? url.href.slice(0, -1) : url.href;
  return href.length <= 2048 ? href : null;
}

/** Stack default from SIGNAL_API_BASE_URL. Empty = no env seed (PG targets only). Invalid non-empty = null. */
export function signalApiBaseUrl(value = process.env.SIGNAL_API_BASE_URL) {
  if (value === undefined || value.trim() === "") return undefined;
  return signalBaseUrl(value.trim());
}

/** Absolute URL path for health probes. Empty uses fallback; invalid non-empty returns null. */
export function signalHealthPath(value: string | undefined, fallback: string) {
  if (value === undefined || value.trim() === "") return fallback;
  const path = value.trim();
  if (!path.startsWith("/") || path.length > 256) return null;
  if (path.includes("?") || path.includes("#") || path.includes("\\")) return null;
  if (path.includes("//") || path.split("/").includes("..") || path.split("/").includes(".")) return null;
  return path.length > 1 && path.endsWith("/") ? path.replace(/\/+$/, "") : path;
}

export function signalHealthLivePath(value = process.env.SIGNAL_HEALTH_LIVE_PATH) {
  return signalHealthPath(value, signalDefaultLivePath);
}

export function signalHealthReadyPath(value = process.env.SIGNAL_HEALTH_READY_PATH) {
  return signalHealthPath(value, signalDefaultReadyPath);
}

/** False when interval, health paths or a non-empty SIGNAL_API_BASE_URL fail validation. */
export function signalMonitorConfigurationOk() {
  if (signalMonitorIntervalMs() === null) return false;
  if (signalHealthLivePath() === null || signalHealthReadyPath() === null) return false;
  if (process.env.SIGNAL_API_BASE_URL !== undefined && process.env.SIGNAL_API_BASE_URL.trim() !== "" && signalApiBaseUrl() === null) return false;
  return true;
}

const baseUrlField = z.string().trim().max(2048).transform((value, context) => {
  const href = signalBaseUrl(value);
  if (!href) { context.addIssue({ code: "custom", message: "URL inválida." }); return z.NEVER; }
  return href;
});

export const signalInfraLinkSchema = z.strictObject({
  role: z.enum(signalInfraRoles),
  label: optionalText(80, "null"),
  hostKey: hostKeySchema,
  vmKey: vmKeySchema.nullable().optional().transform(value => value === undefined ? null : value),
  parentHostKey: hostKeySchema.nullable().optional().transform(value => value === undefined ? null : value),
}).superRefine((value, context) => {
  if (value.vmKey && !value.parentHostKey) context.addIssue({ code: "custom", path: ["parentHostKey"], message: "parentHostKey is required with vmKey" });
  if (!value.vmKey && value.parentHostKey) context.addIssue({ code: "custom", path: ["parentHostKey"], message: "parentHostKey must be null without vmKey" });
});

export const signalTargetWriteSchema = z.strictObject({
  displayName: label(120),
  description: optionalText(240, "null"),
  baseUrl: baseUrlField,
  enabled: z.boolean().default(true),
  dashboardEnabled: z.boolean().default(false),
  critical: z.boolean().default(false),
  displayOrder: z.number().int().min(0).max(2147483647).default(0),
  timeoutMs: z.number().int().min(1000).max(15000).default(signalDefaultTimeoutMs),
});
export const signalTargetPatchSchema = z.strictObject({
  expectedRevision: z.number().int().positive(),
  displayName: label(120).optional(),
  description: optionalText(240, "keep"),
  baseUrl: baseUrlField.optional(),
  enabled: z.boolean().optional(),
  dashboardEnabled: z.boolean().optional(),
  critical: z.boolean().optional(),
  displayOrder: z.number().int().min(0).max(2147483647).optional(),
  timeoutMs: z.number().int().min(1000).max(15000).optional(),
}).refine(value => Object.keys(value).some(key => key !== "expectedRevision"));

export const signalLinkBodySchema = signalInfraLinkSchema.extend({
  expectedRevision: z.number().int().positive(),
});
export const signalUnlinkBodySchema = z.strictObject({
  expectedRevision: z.number().int().positive(),
});

export type SignalTargetInput = z.infer<typeof signalTargetWriteSchema>;
export type SignalInfraLinkInput = z.infer<typeof signalInfraLinkSchema>;
