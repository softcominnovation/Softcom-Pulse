import { z } from "zod";

const control = /[\u0000-\u001F\u007F]/;
const label = (max: number) => z.string().trim().min(1).max(max).refine(value => !control.test(value));
const optionalLabel = (max: number) => z.string().trim().max(max).transform(value => value || null).refine(value => value === null || !control.test(value));
const reservedHeaders = new Set(["host", "content-length", "cookie", "connection", "transfer-encoding"]);
const standardHeaders = new Set(["authorization", "x-api-key"]);
export const probeReasons = { ok: 0, slow: 1, unauthorized: 2, status: 3, json: 4, timeout: 5, network: 6, tls: 7 } as const;
export const probeTimeoutMs = 3000;
export const probeDegradedAfterMs = 800;
export const probeConcurrency = 8;
export const probeStripLength = 40;
export const probeServiceLimit = 100;
export const probeResultTtlSeconds = 48 * 60 * 60;

export function probeIntervalMs(value = process.env.PROBE_INTERVAL_MS) {
  if (value === undefined || value.trim() === "") return 60000;
  if (!/^\d+$/.test(value)) return null;
  const interval = Number(value);
  return Number.isSafeInteger(interval) && interval >= 30000 && interval <= 120000 ? interval : null;
}

const pointer = z.string().max(80).refine(value => value.startsWith("/") && value.split("/").slice(1).every(part => !part.replace(/~0/g, "").replace(/~1/g, "").includes("~")));
const literal = z.union([z.string().max(80), z.number().finite(), z.boolean()]);
const secretValue = z.string().min(1).max(4096).refine(value => !/[\u0000-\u001F\u007F]/.test(value));
export const externalServiceFields = {
  displayName: label(120), description: optionalLabel(240).nullable().default(null), serviceType: optionalLabel(40).nullable().default(null),
  enabled: z.boolean().default(true), dashboardEnabled: z.boolean().default(false), critical: z.boolean().default(false), displayOrder: z.number().int().min(-100000).max(100000).default(0),
  method: z.enum(["GET", "HEAD", "POST"]), url: z.string().max(2048), successMode: z.enum(["http_status", "json_match"]),
  expectedStatuses: z.array(z.number().int().min(200).max(299)).min(1).max(4).default([200]), jsonPointer: pointer.nullable().default(null), expectedValue: literal.nullable().default(null),
  bodyTemplate: z.string().max(2048).nullable().default(null), authMode: z.enum(["none", "header"]), headerName: z.string().trim().max(40).nullable().default(null),
};
export const externalServiceWriteSchema = z.strictObject({ ...externalServiceFields, secret: secretValue.nullable().optional() });
export type ExternalServiceInput = z.infer<typeof externalServiceWriteSchema>;
export const externalServicePatchSchema = z.strictObject({
  expectedRevision: z.number().int().positive(), displayName: label(120).optional(), description: optionalLabel(240).nullable().optional(), serviceType: optionalLabel(40).nullable().optional(),
  enabled: z.boolean().optional(), dashboardEnabled: z.boolean().optional(), critical: z.boolean().optional(), displayOrder: z.number().int().min(-100000).max(100000).optional(),
  method: z.enum(["GET", "HEAD", "POST"]).optional(), url: z.string().max(2048).optional(), successMode: z.enum(["http_status", "json_match"]).optional(),
  expectedStatuses: z.array(z.number().int().min(200).max(299)).min(1).max(4).optional(), jsonPointer: pointer.nullable().optional(), expectedValue: literal.nullable().optional(),
  bodyTemplate: z.string().max(2048).nullable().optional(), authMode: z.enum(["none", "header"]).optional(), headerName: z.string().trim().max(40).nullable().optional(),
  secret: secretValue.nullable().optional(),
});
export const externalServiceHistoryRangeSchema = z.enum(["24h", "7d", "30d"]);
export function serviceNeedsSecret(value: { authMode: "none" | "header"; bodyTemplate: string | null }) {
  return value.authMode === "header" || value.bodyTemplate?.includes("{{secret}}") === true;
}

export function serviceIssues(value: ExternalServiceInput, existingSecret: boolean) {
  const issues: string[] = [];
  if (value.successMode === "http_status" && (value.jsonPointer !== null || value.expectedValue !== null)) issues.push("jsonPointer");
  if (value.successMode === "json_match" && (value.method === "HEAD" || !value.jsonPointer || value.expectedValue === null)) issues.push("successMode");
  if (value.method !== "POST" && value.bodyTemplate !== null) issues.push("bodyTemplate");
  if (value.bodyTemplate !== null) { try { JSON.parse(value.bodyTemplate.replaceAll("{{secret}}", "placeholder")); } catch { issues.push("bodyTemplate"); } }
  const header = value.headerName?.toLowerCase() ?? "";
  if (value.authMode === "none" && value.headerName !== null) issues.push("headerName");
  if (value.authMode === "header" && (!value.headerName || reservedHeaders.has(header) || header.startsWith("proxy-") || !(standardHeaders.has(header) || /^[a-z0-9-]{1,40}$/.test(header)))) issues.push("headerName");
  const needsSecret = serviceNeedsSecret(value);
  if (needsSecret && (value.secret === null || (value.secret === undefined && !existingSecret))) issues.push("secret");
  if (!needsSecret && value.secret) issues.push("secret");
  return issues;
}
