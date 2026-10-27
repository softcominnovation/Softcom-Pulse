import "server-only";
import { z } from "zod";
import { storageSnapshotSchema, type StorageSnapshot, type StorageTechnical } from "../../storage/contracts.ts";
import { metric, keyParts, observedText, observationContext, opaqueReference } from "./observations.ts";
import { mapMetrics, needsValue } from "./mapping.ts";
import { itemSchema, zabbixHostSchema, type Item, type Rpc, type ZabbixHost } from "./types.ts";
import { BffError } from "../bff.ts";
import { snapshotTiming } from "../cache/snapshots.ts";

// Same host + exact mount/key arguments prove logical identity. Direct Agent items
// take precedence over dependent copies; duplicates within that family are ambiguous.
function uniqueSources(items: Item[]) {
  const groups = new Map<string, Item[]>();
  for (const item of items) {
    const { base, args } = keyParts(item.key_);
    const identity = JSON.stringify([base.replace("dependent.", ""), args]);
    groups.set(identity, [...(groups.get(identity) ?? []), item]);
  }
  return [...groups.values()].flatMap(candidates => {
    const direct = candidates.filter(item => !keyParts(item.key_).base.includes("dependent"));
    const preferred = direct.length ? direct : candidates;
    return preferred.length === 1 ? preferred : [];
  });
}

export const isStorageHost = (host: Pick<ZabbixHost, "tags">) => host.tags.some(tag => tag.tag === "role" && tag.value === "storage");
export const storageKey = (hostid: string) => opaqueReference("storage", hostid);
export function needsStorageValue(item: Item) {
  const { base, args } = keyParts(item.key_);
  return !/^(docker|proxmox)\./.test(base) && (needsValue(item) && !base.startsWith("vfs.dev.") ||
    base === "system.cpu.util" && args[1] === "iowait" ||
    base === "vfs.fs.dependent.size" && args[1] === "free" || base === "vfs.fs.size" && args[1] === "free" ||
    base === "vfs.fs.dependent.inode" && args[1] === "pfree" || base === "vfs.fs.inode" && args[1] === "pfree" ||
    base === "vfs.fs.dependent" && args[1] === "readonly");
}
export function normalizeStorage(host: ZabbixHost, items: Item[], now: number): StorageTechnical {
  const own = items.filter(item => item.hostid === host.hostid && item.itemDiscovery?.status !== "1");
  const context = observationContext(own, now);
  const mapped = mapMetrics(uniqueSources(own.filter(item => /^(system\.|vm\.memory\.)/.test(item.key_))), context).metrics;
  const available = own.find(item => item.key_ === "vm.memory.size[available]" && item.units === "B");
  const total = mapped.memoryTotalBytes;
  if (mapped.memoryUsedBytes?.value == null && total && available) {
    const value = metric(available, "bytes", context);
    if (total.value !== null && value.value !== null && total.value >= value.value) mapped.memoryUsedBytes = { ...value, value: total.value - value.value, quality: total.quality === "fresh" && value.quality === "fresh" ? "fresh" : "stale", observedAt: [total.observedAt!, value.observedAt!].sort()[0], validUntil: total.validUntil && value.validUntil ? [total.validUntil, value.validUntil].sort()[0] : null };
  }
  if (mapped.memoryUsagePercent?.value == null && mapped.memoryUsedBytes?.value != null && total?.value && total.value > 0) {
    const used = mapped.memoryUsedBytes;
    mapped.memoryUsagePercent = { ...used, unit: "percent", value: 100 * used.value! / total.value, quality: used.quality === "fresh" && total.quality === "fresh" ? "fresh" : "stale", observedAt: used.observedAt && total.observedAt ? [used.observedAt, total.observedAt].sort()[0] : null, validUntil: used.validUntil && total.validUntil ? [used.validUntil, total.validUntil].sort()[0] : null };
  }
  const evidenceItem = own.find(item => item.key_ === "zabbix[host,agent,available]") ?? own.find(item => item.key_ === "agent.ping");
  const state = observedText(evidenceItem, context), evidence = context.evidence(evidenceItem);
  const ioWait = own.find(item => keyParts(item.key_).base === "system.cpu.util" && keyParts(item.key_).args[1] === "iowait" && item.units === "%");
  const groups = new Map<string, Item[]>(), interfaces = new Map<string, Item[]>();
  for (const item of own) {
    const { base, args } = keyParts(item.key_);
    const target = /^vfs.fs\.(?:dependent(?:\.size|\.inode)?|size|inode)$/.test(base) ? groups : /^net.if.(in|out)$/.test(base) ? interfaces : null;
    if (target && args[0]) target.set(args[0], [...target.get(args[0]) ?? [], item]);
  }
  const volumes = [...groups].sort(([a], [b]) => a.localeCompare(b)).map(([name, candidates]) => {
    const selected = uniqueSources(candidates);
    const fsType = new Set(candidates.flatMap(item => item.tags.filter(tag => tag.tag === "fstype").map(tag => tag.value)));
    const extra = (base: RegExp, arg: string, unit: "bytes" | "percent" | "count", expectedUnits: string) => {
      const item = selected.find(item => base.test(keyParts(item.key_).base) && keyParts(item.key_).args[1] === arg && item.units === expectedUnits && ["0", "3"].includes(item.value_type));
      return item ? metric(item, unit, context) : undefined;
    };
    return { key: opaqueReference("sfs", host.hostid, name), name, filesystemType: fsType.size === 1 ? [...fsType][0] : null, metrics: mapMetrics(selected, context).metrics,
      availableBytes: extra(/^vfs.fs.(dependent.size|size)$/, "free", "bytes", "B"), readOnly: extra(/^vfs.fs.dependent$/, "readonly", "count", ""), inodesFreePercent: extra(/^vfs.fs.(dependent.inode|inode)$/, "pfree", "percent", "%") };
  });
  return { storageKey: storageKey(host.hostid), hostid: host.hostid, technicalName: host.host, name: host.name || host.host, monitoringEnabled: host.status === "0", availability: state === "1" ? "reachable" : state === "2" && evidenceItem?.key_ === "zabbix[host,agent,available]" ? "unreachable" : "unknown",
    classification: { observedAt: new Date(now).toISOString(), validUntil: new Date(now + snapshotTiming().staleAfter).toISOString() },
    evidence: { observedAt: evidence.observedAt, validUntil: evidence.validUntil }, metrics: { ...mapped, ...(ioWait ? { ioWaitPercent: metric(ioWait, "percent", context) } : {}) }, volumes,
    interfaces: [...interfaces].sort(([a], [b]) => a.localeCompare(b)).map(([name, values]) => ({ key: opaqueReference("sif", host.hostid, name), name, metrics: mapMetrics(uniqueSources(values), context).metrics })) };
}
export async function collectStorage(options: { rpc: Rpc; hosts: ZabbixHost[]; items: Item[]; knownHostIds: string[]; previous?: StorageSnapshot | null; now: number; signal?: AbortSignal }): Promise<StorageSnapshot> {
  const { rpc, signal, now } = options;
  const lastAttemptAt = new Date(now).toISOString();
  try {
    const rows = z.array(zabbixHostSchema).parse(await rpc("host.get", { output: ["hostid", "host", "name", "status"], tags: [{ tag: "role", value: "storage", operator: 1 }], selectTags: ["tag", "value"], selectInterfaces: ["type", "main", "available"], limit: 101 }, signal));
    if (rows.length > 100) throw new BffError(503, "storage_inventory_too_large");
    if (new Set(rows.map(host => host.hostid)).size !== rows.length) throw new BffError(503, "storage_cycle_incomplete");
    const hosts = rows.filter(isStorageHost), active = hosts.filter(host => host.status === "0");
    const reused = new Set(options.hosts.map(host => host.hostid));
    const extraIds = active.filter(host => !reused.has(host.hostid)).map(host => host.hostid);
    const output = ["itemid", "hostid", "name", "key_", "type", "value_type", "units", "delay", "status", "state", "lastclock", "master_itemid"];
    let additional: Item[] = [];
    if (extraIds.length) {
      additional = z.array(itemSchema).parse(await rpc("item.get", { hostids: extraIds, output, selectTags: ["tag", "value"], selectPreprocessing: ["type", "params"], selectItemDiscovery: ["status"], limit: 5001 }, signal));
      if (additional.length > 5000) throw new BffError(503, "storage_items_too_large");
      if (additional.some(item => !extraIds.includes(item.hostid)) || new Set(additional.map(item => item.itemid)).size !== additional.length) throw new BffError(503, "storage_cycle_incomplete");
      const selected = additional.filter(needsStorageValue);
      if (selected.length) {
        const values = z.array(z.object({ itemid: z.string(), lastvalue: z.string(), lastclock: z.string(), state: z.string() })).parse(await rpc("item.get", { itemids: selected.map(item => item.itemid), output: ["itemid", "lastvalue", "lastclock", "state"], limit: 5001 }, signal));
        const byId = new Map(values.map(item => [item.itemid, item]));
        if (values.length !== selected.length || selected.some(item => !byId.has(item.itemid))) throw new BffError(503, "storage_cycle_incomplete");
        additional = additional.map(item => ({ ...item, ...byId.get(item.itemid) }));
      }
    }
    const missing = [...new Set([...options.knownHostIds, ...options.previous?.items.map(item => item.hostid) ?? []])].filter(id => !hosts.some(host => host.hostid === id));
    if (missing.length > 100) throw new BffError(503, "storage_inventory_too_large");
    let absent: StorageSnapshot["absent"] = [];
    if (missing.length) {
      const confirmations = z.array(zabbixHostSchema).parse(await rpc("host.get", { hostids: missing, output: ["hostid", "host", "name", "status"], selectTags: ["tag", "value"], limit: 101 }, signal));
      if (confirmations.length > 100) throw new BffError(503, "storage_inventory_too_large");
      if (confirmations.some(host => !missing.includes(host.hostid) || isStorageHost(host)) || new Set(confirmations.map(host => host.hostid)).size !== confirmations.length) throw new BffError(503, "storage_cycle_incomplete");
      absent = missing.map(hostid => ({ hostid, resolution: confirmations.some(host => host.hostid === hostid && !isStorageHost(host)) ? "tag_missing" : "host_missing" }));
    }
    return storageSnapshotSchema.parse({ version: 1, status: "ok", lastAttemptAt, lastSuccessfulAt: lastAttemptAt, error: null, items: hosts.map(host => normalizeStorage(host, host.status === "0" ? [...options.items, ...additional] : [], now)), absent });
  } catch (error) {
    return { version: 1, status: "failed", lastAttemptAt, lastSuccessfulAt: options.previous?.lastSuccessfulAt ?? null, error: error instanceof BffError ? error.code : "storage_collection_failed", items: options.previous?.items ?? [], absent: options.previous?.absent ?? [] };
  }
}
