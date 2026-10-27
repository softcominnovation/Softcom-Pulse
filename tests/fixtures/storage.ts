import type { Page } from "@playwright/test";
import type { Metric } from "../../lib/monitoring/contracts";
import { storagePreferencesSchema, type StorageConfig } from "../../lib/config/storages";
import type { StorageView } from "../../lib/storage/contracts";
import { storageCapacity } from "../../lib/storage/presentation";
import { adminFixture } from "./admin";
import { id, overview } from "./dashboard";
export async function storageUiFixture(page: Page) {
  const admin = await adminFixture(page), at = new Date().toISOString(), until = new Date(Date.now() + 3600000).toISOString();
  const metric = (value: number, unit: Metric["unit"] = "percent"): Metric => ({ value, unit, quality: "fresh", observedAt: at, validUntil: until });
  const volumes = Array.from({ length: 10 }, (_, i) => ({ key: `sfs-${String(i + 1).padStart(32, "0")}`, name: i ? `/data/volume-${i}` : "/", filesystemType: "ext4", metrics: { diskUsagePercent: metric(40), diskUsedBytes: metric(400 * 1024 ** 3, "bytes"), diskTotalBytes: metric(1000 * 1024 ** 3, "bytes") }, availableBytes: metric(500 * 1024 ** 3, "bytes"), readOnly: metric(0, "count"), inodesFreePercent: metric(99) }));
  const item: StorageView = { storageKey: `storage-${"1".repeat(32)}`, technicalName: "fixture-storage-vm", displayName: "Archive One", description: null, configId: id(9090), revision: 1, dashboardEnabled: true, critical: true, displayOrder: 0, presentationStatus: "ready", resolution: "resolved", monitoringEnabled: true, availability: "reachable", stale: false, evidence: { observedAt: at, validUntil: until }, classification: { observedAt: at, validUntil: until }, metrics: { cpuUsagePercent: metric(12.5), memoryUsagePercent: metric(64.4), uptimeSeconds: metric(86450, "seconds"), ioWaitPercent: metric(0) }, capacity: storageCapacity(volumes), volumes, interfaces: [{ key: `sif-${"1".repeat(32)}`, name: "fixture-network", metrics: { networkReceiveBitsPerSecond: metric(1000, "bits/s"), networkTransmitBitsPerSecond: metric(0, "bits/s") } }], selectedInterface: null };
  const config: StorageConfig = { ...storagePreferencesSchema.parse({ displayName: item.displayName, dashboardEnabled: true, critical: true }), id: item.configId!, revision: 1, storageKey: item.storageKey, originalName: item.technicalName, zabbixHostId: "9090", createdAt: at, updatedAt: at };
  const state = { admin, items: [item], configs: [config], writes: [] as StorageConfig[], conflict: false, fail: false, detailCalls: 0, listCalls: 0 };
  const envelope = <T>(data: T) => ({ data, availability: "ready", stale: false, lastUpdated: at, refreshAfterMs: 20000 });
  await page.route("**/api/monitoring/storages", route => { state.listCalls++; return route.fulfill(state.fail ? { status: 503, json: { error: { code: "cache_unavailable" } } } : { json: envelope({ items: state.items, orphans: [], status: "ok", error: null }) }); });
  await page.route("**/api/monitoring/storages/*", route => { state.detailCalls++; return route.fulfill({ json: envelope(state.items[0]) }); });
  await page.route("**/api/settings/storages", route => route.fulfill({ json: { data: state.configs } }));
  await page.route("**/api/settings/storages/*", route => {
    const input = route.request().postDataJSON();
    if (state.conflict) return route.fulfill({ status: 409, json: { error: { code: "revision_conflict" } } });
    Object.assign(state.configs[0], input, { revision: state.configs[0].revision + 1 });
    Object.assign(state.items[0], { ...input, revision: state.configs[0].revision, selectedInterface: state.items[0].interfaces.find(network => network.key === input.networkInterfaceKey) ?? null });
    state.writes.push(structuredClone(state.configs[0]));
    return route.fulfill({ json: { data: state.configs[0] } });
  });
  await page.route("**/api/dashboard/overview*", route => {
    const current = overview(admin.document, new URL(route.request().url()).searchParams.get("screenId") ?? undefined);
    const screen = admin.document.screens.find(screen => screen.id === current.data.screenId)!;
    for (const block of current.data.blocks) {
      block.options = screen.blocks.find(item => item.id === block.blockId)?.options;
      if (block.type === "storage_summary") block.data = { target: state.items[0] };
      if (block.type === "highlighted_resources") block.data = { cards: [{ kind: "storage", item: state.items[0] }] };
    }
    return route.fulfill({ json: current });
  });
  return state;
}
