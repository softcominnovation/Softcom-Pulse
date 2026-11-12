import { z } from "zod";

export const webhookSettingsSchema = z.strictObject({
  active: z.boolean(), url: z.string().nullable(), hasApiKey: z.boolean(), revision: z.number().int().positive(),
});
export type WebhookSettings = z.infer<typeof webhookSettingsSchema>;
export const webhookKeySchema = z.string().min(1).max(2048).regex(/^[!-~](?:[ -~]*[!-~])?$/);
export const webhookWriteSchema = z.strictObject({
  active: z.boolean(), url: z.string().trim().min(1).max(2048).nullable(),
  expectedRevision: z.number().int().positive(),
  apiKey: webhookKeySchema.nullable().optional(),
});
