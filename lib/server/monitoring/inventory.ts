import "server-only";
import { z } from "zod";
import { hostSchema, containerSchema } from "../../monitoring/contracts.ts";
import { resolveResource } from "../../monitoring/selectors.ts";
import type { ResourceInput } from "../../config/resources.ts";
import { BffError } from "../bff.ts";
import { readSnapshotBatch, snapshotData, snapshotKeys, snapshotTiming } from "../cache/snapshots.ts";

export function freshness<T>(data: T, failed: boolean, now = Date.now()): T {
  if (Array.isArray(data)) return data.map(item => freshness(item, failed, now)) as T;
  if (!data || typeof data !== "object") return data;
  const value = data as Record<string, unknown>;
  if (value.quality === "fresh" && (failed || typeof value.observedAt !== "string" || now - Date.parse(value.observedAt) > snapshotTiming().staleAfter)) {
    return { ...value, quality: "stale" } as T;
  }
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, freshness(item, failed, now)])) as T;
}

export async function readInventory(containerHosts: string[] | "all" = [], extraKeys: string[] = []) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const first = await readSnapshotBatch([snapshotKeys.hosts]);
    const hosts = snapshotData(first, snapshotKeys.hosts, z.array(hostSchema), []);
    const selectedHosts = containerHosts === "all" ? hosts.map(host => host.hostKey) : containerHosts;
    const keys = [...new Set([snapshotKeys.hosts, ...selectedHosts.map(snapshotKeys.containers), ...extraKeys])];
    const batch = await readSnapshotBatch(keys);
    if (first.generation !== batch.generation) continue;
    const failed = batch.sync?.status === "failed";
    const containers = selectedHosts.flatMap(hostKey => {
      const items = snapshotData(batch, snapshotKeys.containers(hostKey), z.array(containerSchema), []);
      if (items.some(item => item.hostKey !== hostKey)) throw new BffError(503, "snapshot_invalid");
      return items;
    });
    return { batch, keys, hosts: freshness(hosts, failed), containers: freshness(containers, failed) };
  }
  throw new BffError(503, "snapshot_inconsistent");
}

export async function validateSelection(config: ResourceInput) {
  try {
    const inventory = await readInventory(config.resourceType === "docker_container" ? [config.zabbixHostKey] : []);
    if (resolveResource(config, inventory).resolution === "ambiguous") throw new BffError(400, "selector_ambiguous");
  } catch (error) {
    if (!(error instanceof BffError) || error.status !== 503) throw error;
  }
}
