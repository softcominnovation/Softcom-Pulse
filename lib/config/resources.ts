import { z } from "zod";
import { compileSelector } from "../monitoring/selectors.ts";

export const uuidSchema = z.uuid().transform(value => value.toLowerCase());
export const hostKeySchema = z.string().min(1).max(256).refine(value => value.trim() === value && !/[\u0000-\u001f\u007f/\\]/.test(value));
export const historyRangeSchema = z.enum(["1h", "24h", "7d"]);
export const cardMetricsSourceSchema = z.enum(["auto", "agent", "hypervisor"]);
const commonPresentation = {
  showStatus: z.boolean().default(true), showCpu: z.boolean().default(true), showMemory: z.boolean().default(true),
  showDisk: z.boolean().default(false), showNetwork: z.boolean().default(false), showUptime: z.boolean().default(false),
};
export const hostPresentationSchema = z.strictObject({
  ...commonPresentation,
  /** CPU/RAM on Disponibilidade + Infra host cards. Default = same source as the Asgard VM list. */
  metricsSource: cardMetricsSourceSchema.default("hypervisor"),
});
export const containerPresentationSchema = z.strictObject({
  ...commonPresentation, showHealth: z.boolean().default(false), showHealthTimeline: z.boolean().default(false),
  healthTimelineRange: historyRangeSchema.default("1h"),
}).refine(value => !value.showHealthTimeline || value.showHealth, { path: ["showHealthTimeline"], message: "Timeline requires visible health" });
/** Shared presentation shape: hosts carry metricsSource; containers must not (strict schema). */
export type ResourcePresentation = Omit<z.infer<typeof hostPresentationSchema>, "metricsSource">
  & { metricsSource?: z.infer<typeof cardMetricsSourceSchema> }
  & Partial<z.infer<typeof containerPresentationSchema>>;

const optionalText = (max: number) => z.string().refine(value => !/[\u0000-\u001f\u007f]/.test(value)).transform(value => value.trim()).pipe(z.string().max(max)).transform(value => value || null).nullable().default(null);

const resourceFields = {
  resourceType: z.enum(["host", "docker_container"]), source: z.literal("zabbix").default("zabbix"),
  zabbixHostKey: hostKeySchema, selectorType: z.enum(["exact_name", "name_prefix", "name_contains", "regex"]).nullable().default(null),
  selectorValue: z.string().min(1).max(256).nullable().default(null), displayName: z.string().trim().min(1).max(120).nullable().default(null),
  description: optionalText(240), serviceType: optionalText(40),
  dashboardEnabled: z.boolean().default(false), critical: z.boolean().default(false),
  displayOrder: z.number().int().min(0).max(2147483647).default(0),
  presentation: z.record(z.string(), z.unknown()).default({}), enabled: z.boolean().default(true),
};
export const resourceInputSchema = z.strictObject(resourceFields).transform((value, ctx) => {
  const presentation = (value.resourceType === "host" ? hostPresentationSchema : containerPresentationSchema).safeParse(value.presentation);
  if (!presentation.success) for (const issue of presentation.error.issues) ctx.addIssue({ code: "custom", path: ["presentation", ...issue.path], message: issue.message });
  if (value.resourceType === "host" && (value.selectorType !== null || value.selectorValue !== null)) {
    ctx.addIssue({ code: "custom", path: ["selectorType"], message: "Host selectors must be null" });
  }
  if (value.resourceType === "docker_container") {
    if (!value.selectorType || !value.selectorValue) ctx.addIssue({ code: "custom", path: ["selectorValue"], message: "Container selector is required" });
    else try { compileSelector(value.selectorType, value.selectorValue); }
    catch { ctx.addIssue({ code: "custom", path: ["selectorValue"], message: "Invalid or unsupported selector" }); }
  }
  return { ...value, presentation: (presentation.success ? presentation.data : hostPresentationSchema.parse({})) as ResourcePresentation };
});
export const resourcePatchSchema = z.strictObject({
  resourceType: resourceFields.resourceType.optional(), source: resourceFields.source.removeDefault().optional(),
  zabbixHostKey: hostKeySchema.optional(), selectorType: resourceFields.selectorType.removeDefault().optional(),
  selectorValue: resourceFields.selectorValue.removeDefault().optional(), displayName: resourceFields.displayName.removeDefault().optional(),
  description: resourceFields.description.removeDefault().optional(), serviceType: resourceFields.serviceType.removeDefault().optional(),
  dashboardEnabled: z.boolean().optional(), critical: z.boolean().optional(), displayOrder: resourceFields.displayOrder.removeDefault().optional(),
  presentation: resourceFields.presentation.removeDefault().optional(), enabled: z.boolean().optional(),
}).refine(value => Object.keys(value).length > 0);
export type ResourceInput = z.infer<typeof resourceInputSchema>;
export type ResourceConfig = ResourceInput & { id: string; createdAt: string; updatedAt: string };
export const resourceConfigSchema = z.object({ ...resourceFields, id: uuidSchema, createdAt: z.iso.datetime({ offset: true }), updatedAt: z.iso.datetime({ offset: true }) }).transform(({ id, createdAt, updatedAt, ...input }) => ({ ...resourceInputSchema.parse(input), id, createdAt, updatedAt }));
