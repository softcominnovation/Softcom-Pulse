import { z } from "zod";
import { historyRangeSchema, hostKeySchema, uuidSchema } from "./resources.ts";
import { vmKeySchema } from "./vms.ts";

export const resourceContextSchema = z.strictObject({ parentHostKey: hostKeySchema, vmKey: vmKeySchema, containerReference: z.string().min(1).max(256) });
export type ResourceContext = z.infer<typeof resourceContextSchema>;
export const resourceSelectionSchema = z.object({
  resourceId: uuidSchema.optional(), hostKey: hostKeySchema.optional(), containerReference: z.string().min(1).max(256).optional(),
  parentHostKey: hostKeySchema.optional(), vmKey: vmKeySchema.optional(), range: historyRangeSchema.default("24h"),
}).refine(value => !(value.parentHostKey || value.vmKey) || !!value.parentHostKey && !!value.vmKey && !!value.containerReference && !!value.hostKey);
export type ResourceSelection = z.infer<typeof resourceSelectionSchema>;
