import { z } from "zod";
import { isoSchema, metricSchema, metricsSchema, type Metric } from "../monitoring/contracts.ts";
import { storageDeviceKeySchema, storageKeySchema } from "../config/storages.ts";

export const storageMetricsSchema = metricsSchema.extend({ ioWaitPercent: metricSchema.optional() });
export const storageVolumeSchema = z.object({
  key: storageDeviceKeySchema, name: z.string().min(1).max(512), filesystemType: z.string().max(80).nullable(),
  metrics: metricsSchema, availableBytes: metricSchema.optional(), readOnly: metricSchema.optional(), inodesFreePercent: metricSchema.optional(),
});
export const storageInterfaceSchema = z.object({ key: storageDeviceKeySchema, name: z.string().min(1).max(512), metrics: metricsSchema });
export const storageEvidenceSchema = z.object({ observedAt: isoSchema.nullable(), validUntil: isoSchema.nullable() });
export const storageTechnicalSchema = z.object({
  storageKey: storageKeySchema, hostid: z.string().regex(/^\d+$/), technicalName: z.string().min(1).max(512), name: z.string().min(1).max(512),
  monitoringEnabled: z.boolean(), availability: z.enum(["reachable", "unreachable", "unknown"]), evidence: storageEvidenceSchema,
  classification: storageEvidenceSchema, metrics: storageMetricsSchema, volumes: z.array(storageVolumeSchema), interfaces: z.array(storageInterfaceSchema),
});
export const storageResolutionSchema = z.enum(["resolved", "tag_missing", "host_missing", "inventory_unavailable", "monitoring_disabled"]);
export const storageSnapshotSchema = z.object({
  version: z.literal(1), status: z.enum(["ok", "failed"]), lastAttemptAt: isoSchema, lastSuccessfulAt: isoSchema.nullable(), error: z.string().max(80).nullable(),
  items: z.array(storageTechnicalSchema).max(100),
  absent: z.array(z.object({ hostid: z.string(), resolution: z.enum(["tag_missing", "host_missing"]) })).default([]),
});
export const storageCapacitySchema = z.object({
  coverage: z.enum(["complete", "incomplete", "unconfigured"]), label: z.string(), filesystemKeys: z.array(storageDeviceKeySchema),
  usedBytes: metricSchema.optional(), totalBytes: metricSchema.optional(), availableBytes: metricSchema.optional(), usagePercent: metricSchema.optional(),
});
export const storageViewSchema = z.object({
  storageKey: storageKeySchema, technicalName: z.string(), displayName: z.string(), description: z.string().nullable(),
  configId: z.uuid().nullable(), revision: z.number().int().nonnegative(), dashboardEnabled: z.boolean(), critical: z.boolean(), displayOrder: z.number().int(),
  presentationStatus: z.enum(["ready", "unavailable"]), resolution: storageResolutionSchema, monitoringEnabled: z.boolean(),
  availability: z.enum(["reachable", "unreachable", "unknown"]), stale: z.boolean(), evidence: storageEvidenceSchema, classification: storageEvidenceSchema,
  metrics: storageMetricsSchema, capacity: storageCapacitySchema, volumes: z.array(storageVolumeSchema),
  interfaces: z.array(storageInterfaceSchema), selectedInterface: storageInterfaceSchema.nullable(),
});
export const storageInventorySchema = z.object({
  items: z.array(storageViewSchema), orphans: z.array(storageViewSchema), status: z.enum(["ok", "failed", "no_data"]), error: z.string().nullable(),
});
export type StorageTechnical = z.infer<typeof storageTechnicalSchema>;
export type StorageSnapshot = z.infer<typeof storageSnapshotSchema>;
export type StorageVolume = z.infer<typeof storageVolumeSchema>;
export type StorageCapacity = z.infer<typeof storageCapacitySchema>;
export type StorageView = z.infer<typeof storageViewSchema>;
export type StorageInventory = z.infer<typeof storageInventorySchema>;
export const missingStorageMetric = (unit: Metric["unit"]): Metric => ({ value: null, unit, quality: "missing", observedAt: null, validUntil: null });

