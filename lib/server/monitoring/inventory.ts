import "server-only";
import { z } from "zod";
import { hostSchema, containerSchema } from "../../monitoring/contracts.ts";
import { resolveResource } from "../../monitoring/selectors.ts";
import type { ResourceInput } from "../../config/resources.ts";
import type { ResourceContext } from "../../config/resource-context.ts";
import { BffError } from "../bff.ts";
import { readSnapshotBatch, readResult, snapshotData, snapshotKeys, snapshotTiming } from "../cache/snapshots.ts";

export function freshness<T>(data: T, failed: boolean, now = Date.now()): T {
  if (Array.isArray(data)) return data.map(item => freshness(item, failed, now)) as T;
  if (!data || typeof data !== "object") return data;
  const value = data as Record<string, unknown>;
  if (value.quality === "fresh" && (failed || ("validUntil" in value ? typeof value.validUntil !== "string" || now > Date.parse(value.validUntil) : typeof value.observedAt !== "string" || now - Date.parse(value.observedAt) > snapshotTiming().staleAfter))) {
    return { ...value, quality: "stale" } as T;
  }
  const result = Object.fromEntries(Object.entries(value).map(([key, item]) => [key, freshness(item, failed, now)]));
  if (typeof result.health === "string" && (failed || ("healthValidUntil" in value && (typeof value.healthValidUntil !== "string" || now > Date.parse(value.healthValidUntil))))) { result.health = "unknown"; result.healthReason = "stale"; }
  const evidence = value.evidence as { validUntil?: string | null } | undefined;
  if (failed || (evidence && "validUntil" in evidence && (!evidence.validUntil || now > Date.parse(evidence.validUntil)))) {
    if ("availability" in result) result.availability = "unknown";
    if ("status" in result) result.status = "unknown";
    if ("state" in result) result.state = "unknown";
  }
  return result as T;
}

export async function readInventory(containerHosts: string[] | "all" = [], extraKeys: string[] = []) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const first = await readSnapshotBatch([snapshotKeys.hosts]);
    const hosts = snapshotData(first, snapshotKeys.hosts, z.array(hostSchema), []);
    const selectedHosts = containerHosts === "all" ? hosts.map(host => host.hostKey) : containerHosts;
    const keys = [...new Set([snapshotKeys.hosts, ...selectedHosts.map(snapshotKeys.containers), ...extraKeys])];
    const batch = await readSnapshotBatch(keys);
    if (first.generation !== batch.generation) continue;
    const failed = readResult(null, batch, keys).stale;
    const containers = selectedHosts.flatMap(hostKey => {
      const items = snapshotData(batch, snapshotKeys.containers(hostKey), z.array(containerSchema), []);
      if (items.some(item => item.hostKey !== hostKey)) throw new BffError(503, "snapshot_invalid");
      return items;
    });
    return { batch, keys, hosts: freshness(hosts, failed), containers: freshness(containers, failed) };
  }
  throw new BffError(503, "snapshot_inconsistent");
}

export async function validateSelection(config: ResourceInput, requireFresh = false, context?: ResourceContext) {
  try {
    const inventory = await readInventory(config.resourceType === "docker_container" ? [config.zabbixHostKey] : []);
    const result = resolveResource(config, inventory);
    if (context) {
      const vm = inventory.hosts.find(host => host.hostKey === context.parentHostKey && host.role === "hypervisor")?.vms.find(vm => vm.vmKey === context.vmKey && vm.parentHostKey === context.parentHostKey && !vm.name.startsWith("tpl"));
      const agent = inventory.hosts.find(host => host.hostKey === vm?.linuxHostKey && host.role === "linux");
      if (!vm?.linuxHostKey || !agent || agent.availability === "unreachable" || vm.linuxHostKey !== config.zabbixHostKey || config.resourceType !== "docker_container" || !result.resolved || !("reference" in result.target) || result.target.reference !== context.containerReference) throw new BffError(409, "resource_context_changed");
    }
    if (result.resolution === "ambiguous") throw new BffError(400, "selector_ambiguous");
    if (requireFresh) {
      const state = readResult(null, inventory.batch, inventory.keys);
      if (state.stale || state.availability !== "ready") throw new BffError(409, "resource_inventory_unavailable");
      if (!result.resolved) throw new BffError(400, "resource_not_discovered");
      const evidence = result.target.evidence;
      if (!evidence.observedAt || evidence.validUntil !== undefined && (!evidence.validUntil || Date.parse(evidence.validUntil) < Date.now())) throw new BffError(409, "resource_inventory_unavailable");
    }
  } catch (error) {
    if (requireFresh && error instanceof BffError && error.status === 503) throw new BffError(409, "resource_inventory_unavailable");
    if (!(error instanceof BffError) || error.status !== 503) throw error;
  }
}
