import "server-only";
import { z } from "zod";
import { metricSchema } from "../../monitoring/contracts.ts";

export const bindingSchema = z.object({
  key: z.string().max(512), itemid: z.string().regex(/^\d+$/), valueType: z.enum(["0", "1", "3", "4"]),
  unit: metricSchema.shape.unit, scale: z.number().finite(), offset: z.number().finite(),
  kind: z.enum(["numeric", "health", "status"]), maxGapSeconds: z.number().positive(),
  quality: metricSchema.shape.quality, observedAt: z.string().nullable(),
  proof: z.object({ itemid: z.string().regex(/^\d+$/), valueType: z.enum(["0", "3"]), maxGapSeconds: z.number().positive() }).optional(),
});
export const sourceBindingsSchema = z.record(z.string(), z.object({ identity: z.string(), bindings: z.array(bindingSchema).max(128) }));
export type Binding = z.infer<typeof bindingSchema>;
export type SourceBindings = z.infer<typeof sourceBindingsSchema>;
export const sourceKey = (type: string, hostKey: string, reference: string | null = null) => JSON.stringify([type, hostKey, reference]);
