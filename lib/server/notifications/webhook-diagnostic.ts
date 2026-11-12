import { z } from "zod";

// Free-form upstream titles can carry credentials or URLs. Fall back to the catalog message in that case.
const safeTitle = z.string().trim().min(1).max(512)
  .refine(value => !/[\p{C}]|:\/\/|www\.|bearer\s|basic\s|password|passwd|senha|api[_ -]?key|token|secret|authorization|cookie|credential|[?&][\w.-]+=|eyJ[\w-]+\.|[\w+/=-]{48}/iu.test(value));
export const diagnosticSchema = z.strictObject({
  title: safeTitle.optional().catch(undefined),
  host: z.string().regex(/^[a-z\d_.: -]{1,128}$/i).optional().catch(undefined),
  zabbixEventId: z.string().regex(/^\d{1,20}$/).optional().catch(undefined),
  zabbixTriggerId: z.string().regex(/^\d{1,20}$/).optional().catch(undefined),
  subject: z.enum(["container_health", "container_state", "filesystem", "memory", "cpu", "agent"]).optional().catch(undefined),
  reason: z.enum(["ok","slow","unauthorized","status","json","timeout","network","tls","attention","degraded","down","no_data","health","availability"]).optional().catch(undefined),
  httpStatus: z.number().int().min(100).max(599).optional().catch(undefined),
});
export type WebhookDiagnostic = Omit<z.input<typeof diagnosticSchema>, "reason"> & { reason?: string };
