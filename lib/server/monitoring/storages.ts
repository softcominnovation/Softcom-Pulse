import "server-only";
import { storageKeySchema, type StorageConfig } from "../../config/storages.ts";
import { storageSnapshotSchema, type StorageInventory, type StorageTechnical, type StorageView } from "../../storage/contracts.ts";
import { storageCapacity, publicStorage } from "../../storage/presentation.ts";
import { BffError } from "../bff.ts";
import { listStorageConfigs } from "../config/storages.ts";
import { readSnapshotBatch, readResult, snapshotData, snapshotKeys, type SnapshotBatch } from "../cache/snapshots.ts";
import { freshness } from "./inventory.ts";
import type { ReadResult } from "../../monitoring/contracts.ts";

export async function readStorages(options: { batch?: SnapshotBatch; publicRead?: boolean } = {}): Promise<ReadResult<StorageInventory>> {
  const batch = options.batch ?? await readSnapshotBatch([snapshotKeys.storages]).catch(() => null);
  const snapshot = batch ? snapshotData(batch, snapshotKeys.storages, storageSnapshotSchema.nullable(), null) : null;
  let configs: StorageConfig[] = [], preferencesAvailable = true;
  try { configs = await listStorageConfigs(); } catch { preferencesAvailable = false; }
  const envelope = batch ? readResult(null, batch, [snapshotKeys.storages]) : { availability: "no_data" as const, stale: true, lastUpdated: null, refreshAfterMs: 20000 };
  const stale = !snapshot || snapshot.status !== "ok" || envelope.stale;
  const view = (source: StorageTechnical | undefined, config?: StorageConfig): StorageView => {
    const now = Date.now();
    const expired = stale || !source?.classification.validUntil || Date.parse(source.classification.validUntil) <= now;
    const technical = source ? freshness(source, expired) : null;
    const resolution = !source ? snapshot?.status === "ok" && !envelope.stale ? snapshot.absent.find(item => item.hostid === config?.zabbixHostId)?.resolution ?? "inventory_unavailable" : "inventory_unavailable" : !source.monitoringEnabled ? "monitoring_disabled" : "resolved";
    const capacity = storageCapacity(technical?.volumes ?? [], config);
    return {
      storageKey: source?.storageKey ?? config!.storageKey, technicalName: source?.technicalName ?? config!.originalName,
      displayName: config?.displayName ?? source?.name ?? config!.originalName, description: config?.description ?? null,
      configId: config?.id ?? null, revision: config?.revision ?? 0, critical: config?.critical ?? false, displayOrder: config?.displayOrder ?? 0, dashboardEnabled: config?.dashboardEnabled ?? false,
      resolution, monitoringEnabled: source?.monitoringEnabled ?? false, presentationStatus: preferencesAvailable ? "ready" : "unavailable", stale: expired,
      availability: technical?.availability ?? "unknown", evidence: source?.evidence ?? { observedAt: null, validUntil: null }, classification: source?.classification ?? { observedAt: null, validUntil: null },
      metrics: technical?.metrics ?? {}, capacity, volumes: technical?.volumes ?? [], interfaces: technical?.interfaces ?? [],
      selectedInterface: config?.networkInterfaceKey ? technical?.interfaces.find(item => item.key === config.networkInterfaceKey) ?? null : null,
    };
  };
  const byKey = new Map(configs.map(config => [config.storageKey, config]));
  const items = (snapshot?.items ?? []).map(source => view(source, byKey.get(source.storageKey))).sort((a, b) => a.displayOrder - b.displayOrder || a.displayName.localeCompare(b.displayName, "pt") || a.storageKey.localeCompare(b.storageKey));
  const orphans = configs.filter(config => !snapshot?.items.some(item => item.storageKey === config.storageKey)).map(config => view(undefined, config));
  return { ...envelope, availability: snapshot ? "ready" : "no_data", stale, lastUpdated: snapshot?.lastSuccessfulAt ?? null, presentationStatus: preferencesAvailable ? "ready" : "unavailable",
    data: { items: options.publicRead ? items.map(publicStorage) : items, orphans: options.publicRead ? [] : orphans, status: snapshot?.status ?? "no_data", error: snapshot?.error ?? null } };
}
export async function readStorage(key: string, publicRead = false) {
  storageKeySchema.parse(key);
  const result = await readStorages({ publicRead });
  const item = [...result.data.items, ...result.data.orphans].find(item => item.storageKey === key);
  if (!item) throw new BffError(404, "storage_not_found");
  return { ...result, data: item };
}
