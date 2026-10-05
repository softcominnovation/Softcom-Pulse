import { z } from "zod";
import { hostKeySchema } from "./resources.ts";

export const templateKeySchema = z.string().regex(/^vm-[a-f0-9]{32}$/);
export const templateRoleSchema = z.enum(["worker", "manager"]);
const label = z.string().trim().min(1).max(120).regex(/^[^\u0000-\u001f\u007f]+$/);
export const templateWriteSchema = z.strictObject({
  expectedRevision: z.number().int().min(0).max(2147483646),
  displayName: label.nullable(), roleOverride: templateRoleSchema.nullable(),
});
export const templateConfigSchema = z.object({
  templateKey: templateKeySchema, hostKey: hostKeySchema, templateId: z.string().regex(/^\d+$/).max(64),
  virtualizationType: z.enum(["qemu", "lxc"]), originalName: z.string().min(1).max(512),
  displayName: label.nullable(), roleOverride: templateRoleSchema.nullable(), revision: z.number().int().positive(),
  createdAt: z.iso.datetime({ offset: true }), updatedAt: z.iso.datetime({ offset: true }),
});
export type TemplateConfig = z.infer<typeof templateConfigSchema>;
