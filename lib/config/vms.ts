import { z } from "zod";
import { hostKeySchema } from "./resources.ts";

export const vmKeySchema = z.string().regex(/^vm-[a-f0-9]{32}$/);
export const displayNameSchema = z.string().regex(/^[^\u0000-\u001f\u007f]*$/).trim().max(120).transform(value => value || null).nullable();
export const vmWriteSchema = z.strictObject({ expectedRevision: z.number().int().min(0).max(2147483646), displayName: displayNameSchema });
export const vmConfigSchema = z.object({
  vmKey: vmKeySchema, hostKey: hostKeySchema, vmId: z.string().regex(/^\d+$/).max(64),
  virtualizationType: z.enum(["qemu", "lxc"]), originalName: z.string().min(1).max(512),
  displayName: displayNameSchema, revision: z.number().int().positive(),
  createdAt: z.iso.datetime({ offset: true }), updatedAt: z.iso.datetime({ offset: true }),
});
export type VmDisplayConfig = z.infer<typeof vmConfigSchema>;
