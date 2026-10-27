import { z } from "zod";

export const storageKeySchema = z.string().regex(/^storage-[a-f0-9]{32}$/);
export const storageDeviceKeySchema = z.string().regex(/^s(?:fs|if)-[a-f0-9]{32}$/);
const label = z.string().trim().max(120).regex(/^[^\u0000-\u001f\u007f]*$/).transform(value => value || null).nullable();
export const storagePreferenceFields = {
  displayName: label.default(null),
  description: z.string().trim().max(240).regex(/^[^\u0000-\u001f\u007f]*$/).transform(value => value || null).nullable().default(null),
  dashboardEnabled: z.boolean().default(false), critical: z.boolean().default(false),
  displayOrder: z.number().int().min(0).max(100000).default(0),
  filesystemKeys: z.array(storageDeviceKeySchema).min(1).max(32).refine(values => new Set(values).size === values.length).nullable().default(null),
  independentVolumesConfirmed: z.boolean().default(false),
  networkInterfaceKey: storageDeviceKeySchema.nullable().default(null),
};
export const storagePreferencesSchema = z.strictObject(storagePreferenceFields).refine(value => !value.filesystemKeys || value.filesystemKeys.length < 2 || value.independentVolumesConfirmed, { path: ["independentVolumesConfirmed"], message: "Confirme a independência dos volumes." });
export const storageWriteSchema = z.strictObject({ ...storagePreferenceFields, expectedRevision: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER - 1) }).refine(value => !value.filesystemKeys || value.filesystemKeys.length < 2 || value.independentVolumesConfirmed, { path: ["independentVolumesConfirmed"], message: "Confirme a independência dos volumes." });
export const storageConfigSchema = z.object({
  ...storagePreferenceFields, id: z.uuid(), storageKey: storageKeySchema, zabbixHostId: z.string().regex(/^\d+$/), originalName: z.string().min(1).max(512),
  revision: z.number().int().positive(), createdAt: z.iso.datetime({ offset: true }), updatedAt: z.iso.datetime({ offset: true }),
});
export type StoragePreferences = z.infer<typeof storagePreferencesSchema>;
export type StorageConfig = z.infer<typeof storageConfigSchema>;
export type StorageWrite = z.infer<typeof storageWriteSchema>;

