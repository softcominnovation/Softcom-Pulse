import { z } from "zod";

const control = /[\u0000-\u001F\u007F]/;
const notesControl = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/;
const label = (max: number) => z.string().trim().min(1).max(max).refine(value => !control.test(value));
export const vpsMonitorReasons = { ok: 0, slow: 1, unauthorized: 2, status: 3, json: 4, timeout: 5 } as const;
export const vpsDefaultTimeoutMs = 5000;
export const vpsConcurrency = 8;
export const vpsStripLength = 40;
export const standaloneVpsLimit = 100;
export const vpsStackLimit = 50;
export const vpsSampleRetentionMs = 30 * 24 * 60 * 60 * 1000;
export const vpsHistoryRangeSchema = z.enum(["24h", "7d", "30d"]);
export type MonitorState = "inactive" | "not_configured" | "pending" | "up" | "down" | "paused";

export function vpsMonitorIntervalMs(value = process.env.VPS_MONITOR_INTERVAL_MS) {
  if (value === undefined || value.trim() === "") return 60000;
  if (!/^\d+$/.test(value)) return null;
  const interval = Number(value);
  return Number.isSafeInteger(interval) && interval >= 30000 && interval <= 120000 ? interval : null;
}

export function monitorState(enabled: boolean, monitorConfigured: boolean, reason: number | null, monitorPaused = false): MonitorState {
  if (!enabled) return "inactive";
  if (monitorPaused) return "paused";
  if (!monitorConfigured) return "not_configured";
  if (reason === null) return "pending";
  if (reason === vpsMonitorReasons.ok || reason === vpsMonitorReasons.slow || reason === vpsMonitorReasons.json) return "up";
  return "down";
}

function httpUrl(value: string, query: "allow" | "reject") {
  let url: URL;
  try { url = new URL(value); } catch { return null; }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  if (url.username || url.password || url.hash) return null;
  if (query === "reject" && url.search) return null;
  if (url.pathname.length > 1 && url.pathname.endsWith("/")) url.pathname = url.pathname.replace(/\/+$/, "");
  url.hash = "";
  const href = url.href.endsWith("/") && url.pathname === "/" ? url.href.slice(0, -1) : url.href;
  return href.length <= 2048 ? href : null;
}

const optionalHttp = (query: "allow" | "reject", missing: "null" | "keep") => z.string().trim().max(2048).nullable().optional().transform((value, context) => {
  if (value === undefined) return missing === "null" ? null : undefined;
  if (value === null || value === "") return null;
  const href = httpUrl(value, query);
  if (!href) { context.addIssue({ code: "custom", message: "Valor inválido." }); return z.NEVER; }
  return href;
});

const domain = (missing: "null" | "keep") => z.string().trim().max(255).nullable().optional().transform((value, context) => {
  if (value === undefined) return missing === "null" ? null : undefined;
  if (value === null || value === "") return null;
  if (control.test(value) || value.includes("://") || value.includes("/") || value.includes(":") || value.includes(" ")) {
    context.addIssue({ code: "custom", message: "Valor inválido." });
    return z.NEVER;
  }
  const labels = value.split(".");
  const ok = labels.every(part => part.length > 0 && part.length <= 63 && /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/i.test(part));
  if (!ok) { context.addIssue({ code: "custom", message: "Valor inválido." }); return z.NEVER; }
  return value;
});

const optionalText = (max: number, missing: "null" | "keep") => z.string().trim().max(max).nullable().optional().transform((value, context) => {
  if (value === undefined) return missing === "null" ? null : undefined;
  if (value === null || value === "") return null;
  if (control.test(value)) { context.addIssue({ code: "custom", message: "Valor inválido." }); return z.NEVER; }
  return value;
});
function isStandaloneIp(value: string) {
  if (!value || value.includes("/") || value.includes("%")) return false;
  try {
    const url = new URL(value.includes(":") ? `http://[${value}]` : `http://${value}`);
    return url.port === "" && url.pathname === "/" && url.hostname === value;
  } catch { return false; }
}
const ip = z.string().trim().refine(isStandaloneIp);
const apiKey = z.string().max(4096).refine(value => value.trim().length > 0 && !control.test(value));

export const standaloneVpsWriteSchema = z.strictObject({
  name: label(120),
  provider: optionalText(120, "null"),
  ip,
  domain: domain("null"),
  managerUrl: optionalHttp("allow", "null"),
  baseUrl: optionalHttp("reject", "null"),
  apiKey: apiKey.optional(),
  enabled: z.boolean().default(true),
  dashboardEnabled: z.boolean().default(false),
  timeoutMs: z.number().int().min(1000).max(30000).default(vpsDefaultTimeoutMs),
});
export const standaloneVpsPatchSchema = z.strictObject({
  expectedRevision: z.number().int().positive(),
  name: label(120).optional(),
  provider: optionalText(120, "keep"),
  ip: ip.optional(),
  domain: domain("keep"),
  managerUrl: optionalHttp("allow", "keep"),
  baseUrl: optionalHttp("reject", "keep"),
  apiKey: z.union([z.string().max(4096), z.null()]).optional(),
  enabled: z.boolean().optional(),
  monitorPaused: z.boolean().optional(),
  dashboardEnabled: z.boolean().optional(),
  timeoutMs: z.number().int().min(1000).max(30000).optional(),
});
export const vpsStackWriteSchema = z.strictObject({
  name: label(120),
  link: optionalHttp("allow", "null"),
  notes: z.string().max(2000).nullable().optional().transform(value => {
    if (value === undefined || value === null) return null;
    const notes = value.trim();
    return notes || null;
  }).refine(value => value === null || !notesControl.test(value)),
});
export const vpsStackPatchSchema = z.strictObject({
  name: label(120).optional(),
  link: optionalHttp("allow", "keep"),
  notes: z.string().max(2000).nullable().optional().transform(value => {
    if (value === undefined) return undefined;
    if (value === null) return null;
    const notes = value.trim();
    return notes || null;
  }).refine(value => value === undefined || value === null || !notesControl.test(value)),
});

export type StandaloneVpsInput = z.infer<typeof standaloneVpsWriteSchema>;
const monitorStateSchema = z.enum(["inactive", "not_configured", "pending", "up", "down", "paused"]);
export const standaloneVpsCardSchema = z.object({
  id: z.uuid(), name: z.string(), provider: z.string().nullable(), ip: z.string(), domain: z.string().nullable(), managerUrl: z.string().nullable(), baseUrl: z.string().nullable(),
  monitorConfigured: z.boolean(), enabled: z.boolean(), monitorPaused: z.boolean().default(false), dashboardEnabled: z.boolean(), timeoutMs: z.number(), revision: z.number(), monitorState: monitorStateSchema, apiKey: z.string().nullable().optional(),
  progressStartedAt: z.string().nullable().optional(),
  reason: z.number().nullable(), latencyMs: z.number().nullable(), cpuPercent: z.number().nullable(), memoryPercent: z.number().nullable(), diskPercent: z.number().nullable(),
  checkedAt: z.string().nullable(), strip: z.array(z.number().int()), createdAt: z.string(), updatedAt: z.string(),
});
export type StandaloneVpsCard = z.infer<typeof standaloneVpsCardSchema>;
const diskSchema = z.object({ device: z.string().nullable(), type: z.string().nullable(), mount: z.string().nullable(), size: z.string().nullable(), used: z.string().nullable(), available: z.string().nullable(), use: z.number().nullable() });
export const standaloneVpsDetailSchema = standaloneVpsCardSchema.extend({
  stacks: z.array(z.object({ id: z.uuid(), vpsId: z.uuid(), name: z.string(), link: z.string().nullable(), notes: z.string().nullable(), createdAt: z.string(), updatedAt: z.string() })),
  result: z.object({
    reason: z.number(), latencyMs: z.number().nullable(), cpuPercent: z.number().nullable(), memoryPercent: z.number().nullable(), diskPercent: z.number().nullable(), checkedAt: z.string(),
    cpu: z.object({ cores: z.number().nullable(), speed: z.string().nullable(), coresLoad: z.array(z.object({ core: z.string(), load: z.number().nullable() })) }),
    memory: z.object({ total: z.string().nullable(), used: z.string().nullable(), free: z.string().nullable() }),
    disks: z.array(diskSchema),
  }).nullable(),
  samples: z.array(z.object({ checkedAt: z.string(), reason: z.number(), latencyMs: z.number().nullable(), cpuPercent: z.number().nullable(), memoryPercent: z.number().nullable(), diskPercent: z.number().nullable() })),
  range: z.enum(["24h", "7d", "30d"]),
});
export type StandaloneVpsDetail = z.infer<typeof standaloneVpsDetailSchema>;
export type VpsStackRecord = StandaloneVpsDetail["stacks"][number];
export type VpsStackInput = z.infer<typeof vpsStackWriteSchema>;

export function monitorEndpoint(baseUrl: string, path: "/ping/latency" | "/status") {
  const url = new URL(baseUrl);
  url.pathname = `${url.pathname.replace(/\/$/, "")}${path}`;
  url.search = "";
  url.hash = "";
  return url.toString();
}
