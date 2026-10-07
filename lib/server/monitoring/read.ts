import "server-only";
import { z } from "zod";
import { blockCatalog, effectiveOptions } from "../../config/presentation.ts";
import type { ResourceConfig } from "../../config/resources.ts";
import { resolveResource } from "../../monitoring/selectors.ts";
import {
  hostSchema, problemSchema, overviewSnapshotSchema, emptySummary,
  type Host, type Container, type ConfiguredResource, type Metrics, type Overview, type OverviewBlock, type History,
} from "../../monitoring/contracts.ts";
import { BffError } from "../bff.ts";
import { getPresentation, getResource, listResources } from "../config/repository.ts";
import { readSnapshotBatch, readResult, snapshotData, snapshotKeys } from "../cache/snapshots.ts";

import { freshness, readInventory } from "./inventory.ts";
import { sourceBindingsSchema, sourceKey } from "../zabbix/bindings.ts";
import { queryHistory } from "../zabbix/history.ts";
import { isVmTemplate, operationalHost, operationalProblems } from "./virtual-machines.ts";
import { readDisplayNames } from "./display-names.ts";
import { visibleMetric } from "../../services/presentation.ts";

export function linkedMachineName(hostKey: string, hosts: Host[]) {
  const vm = hosts.flatMap(host => host.vms).find(item => item.linuxHostKey === hostKey);
  if (vm) return vm.displayName ?? vm.name;
  const host = hosts.find(item => item.hostKey === hostKey);
  return host?.displayName ?? host?.name ?? hostKey;
}
export function configuredResource(config: ResourceConfig, inventory: { hosts: Host[]; containers: Container[] }): ConfiguredResource {
  const resolution = resolveResource(config, inventory);
  return { id: config.id, config, resolved: resolution.resolved, resolution: resolution.resolution, resource: resolution.target, metrics: resolution.target?.metrics ?? {} };
}
export function cardResource(resource: ConfiguredResource): ConfiguredResource {
  const p = resource.config.presentation;
  const visibleMetrics = (metrics: Metrics): Metrics => Object.fromEntries(Object.entries(metrics).filter(([key]) => {
    if (key.startsWith("cpu")) return p.showCpu;
    if (key.startsWith("memory")) return p.showMemory;
    if (key.startsWith("disk")) return p.showDisk;
    if (key.startsWith("network")) return p.showNetwork;
    if (key === "uptimeSeconds") return p.showUptime;
    return false;
  }));
  const target = resource.resource;
  const metrics = visibleMetrics(resource.metrics);
  if (!target) return { ...resource, metrics };
  if ("reference" in target) return { ...resource, metrics, resource: {
    ...target, metrics, status: p.showStatus ? target.status : "unknown", health: "showHealth" in p && p.showHealth ? target.health : "unknown",
  } };
  return { ...resource, metrics, resource: { ...target, metrics, availability: p.showStatus ? target.availability : "unknown",
    storages: p.showDisk ? target.storages.map(item => ({ ...item, metrics: visibleMetrics(item.metrics) })) : [],
    filesystems: p.showDisk ? target.filesystems.map(item => ({ ...item, metrics: visibleMetrics(item.metrics) })) : [],
    interfaces: p.showNetwork ? target.interfaces.map(item => ({ ...item, metrics: visibleMetrics(item.metrics) })) : [],
    vms: [],
  } };
}
function resourceKeys(config: ResourceConfig) {
  return [config.resourceType === "host" ? snapshotKeys.hosts : snapshotKeys.containers(config.zabbixHostKey)];
}
export async function readHosts() {
  const batch = await readSnapshotBatch([snapshotKeys.hosts, snapshotKeys.overview]);
  const result = readResult(freshness(snapshotData(batch, snapshotKeys.hosts, z.array(hostSchema), []).map(operationalHost), readResult(null, batch, [snapshotKeys.hosts]).stale), batch, [snapshotKeys.hosts]);
  const overview = snapshotData(batch, snapshotKeys.overview, overviewSnapshotSchema.nullable(), null);
  const effectiveKey = overview?.asgardSummary.host?.hostKey;
  const names = await readDisplayNames(result.data);
  return { ...result, data: result.data.map(names.host), presentationStatus: names.status, asgardHostKey: result.data.find(host => host.role === "hypervisor" && host.hostKey === effectiveKey)?.hostKey ?? null };
}
export async function readHost(hostKey: string) {
  const key = snapshotKeys.host(hostKey);
  const { hosts, batch } = await readInventory([], [key]);
  const detailed = snapshotData(batch, key, hostSchema.nullable(), null);
  if (detailed && detailed.hostKey !== hostKey) throw new BffError(503, "snapshot_invalid");
  const host = detailed ?? hosts.find(item => item.hostKey === hostKey);
  if (!host) throw new BffError(404, "host_not_found");
  const names = await readDisplayNames(hosts);
  return { ...readResult(names.host(freshness(operationalHost(host), readResult(null, batch, [key, snapshotKeys.hosts]).stale)), batch, [key, snapshotKeys.hosts]), presentationStatus: names.status };
}
export async function readContainers(hostKey?: string) {
  const { hosts, containers, batch, keys } = await readInventory(hostKey ? [hostKey] : "all");
  if (hostKey && !hosts.some(host => host.hostKey === hostKey)) throw new BffError(404, "host_not_found");
  const names = await readDisplayNames(hosts, containers);
  return { ...readResult(containers.map(names.container), batch, keys.filter(key => key !== snapshotKeys.hosts)), presentationStatus: names.status };
}
export async function readProblems() {
  const { batch, hosts, containers } = await readInventory("all", [snapshotKeys.problems]);
  const names = await readDisplayNames(hosts, containers);
  return { ...readResult(operationalProblems(snapshotData(batch, snapshotKeys.problems, z.array(problemSchema), []), hosts).map(names.problem), batch, [snapshotKeys.problems]), presentationStatus: names.status };
}
export async function readServices(id?: string) {
  const allConfigs = await listResources();
  const configs = id ? allConfigs.filter(config => config.id === id) : allConfigs;
  if (id && !configs.length) throw new BffError(404, "resource_not_found");
  const containerHosts = [...new Set(configs.filter(config => config.resourceType === "docker_container").map(config => config.zabbixHostKey))];
  const current = await readInventory(containerHosts);
  const names = await readDisplayNames(current.hosts, current.containers, allConfigs);
  const resources = configs.map(config => configuredResource(config, { ...current, hosts: current.hosts.map(operationalHost).map(names.host), containers: current.containers.map(names.container) }));
  return { ...readResult(id ? resources[0] : resources, current.batch, configs.flatMap(resourceKeys)), presentationStatus: names.status };
}
export async function readOverview(screenId?: string) {
  const presentation = await getPresentation();
  const screen = presentation.data.screens.find(item => item.enabled && (!screenId || item.id === screenId));
  if (!screen) throw new BffError(404, "screen_not_found");
  const visibleBlocks = screen.blocks.filter(block => block.enabled);
  const includeHighlights = visibleBlocks.some(block => block.type === "highlighted_resources");
  const references = new Set(visibleBlocks.flatMap(block => block.resourceConfigId ? [block.resourceConfigId] : []));
  const allConfigs = await listResources();
  const configs = allConfigs.filter(config => config.enabled && config.dashboardEnabled && (includeHighlights || references.has(config.id)));
  const containerHosts = [...new Set(configs.filter(config => config.resourceType === "docker_container").map(config => config.zabbixHostKey))];
  const current = await readInventory(visibleBlocks.some(block => block.type === "container_inventory" || block.type === "problems") ? "all" : containerHosts, [snapshotKeys.overview, snapshotKeys.problems]);
  const base = freshness(snapshotData(current.batch, snapshotKeys.overview, overviewSnapshotSchema, {
    summary: emptySummary(), asgardSummary: { host: null, vms: [] },
  }), readResult(null, current.batch, current.keys).stale);
  const names = await readDisplayNames(current.hosts, current.containers, allConfigs);
  const named = { ...current, hosts: current.hosts.map(names.host), containers: current.containers.map(names.container) };
  const resources = configs.map(config => ({ ...cardResource(configuredResource(config, named)), linkedVmName: linkedMachineName(config.zabbixHostKey, named.hosts) }));
  const problems = operationalProblems(snapshotData(current.batch, snapshotKeys.problems, z.array(problemSchema), []), current.hosts).map(names.problem);
  base.asgardSummary = { host: base.asgardSummary.host ? names.host(operationalHost(base.asgardSummary.host)) : null, vms: base.asgardSummary.vms.filter(vm => !isVmTemplate(vm)).map(names.vm) };
  if (base.summary.vms !== null) base.summary.vms = current.batch.snapshots.get(snapshotKeys.hosts) ? current.hosts.reduce((n, host) => n + operationalHost(host).vms.length, 0) : null;
  if (base.summary.problems !== null) base.summary.problems = current.batch.snapshots.get(snapshotKeys.problems) ? problems.length : null;
  const blocks: OverviewBlock[] = screen.blocks.filter(block => block.enabled).map(block => {
    let data: OverviewBlock["data"] = null;
    let keys: string[] = [];
    if (block.type === "summary") { data = base.summary; keys = [snapshotKeys.overview]; }
    if (block.type === "asgard_summary") { data = base.asgardSummary; keys = [snapshotKeys.overview]; }
    if (block.type === "problems") { data = problems; keys = [snapshotKeys.problems]; }
    if (block.type === "host_inventory") { data = named.hosts.map(operationalHost); keys = [snapshotKeys.hosts]; }
    if (block.type === "container_inventory") { data = named.containers; keys = current.keys.filter(key => key.startsWith("pulse:inventory:containers:")); }
    if (block.type === "highlighted_resources") { data = resources; keys = configs.flatMap(resourceKeys); }
    if (block.type === "resource_card") {
      data = resources.find(resource => resource.id === block.resourceConfigId) ?? null;
      keys = data ? resourceKeys(data.config) : [];
    }
    const result = readResult(data, current.batch, keys);
    return { blockId: block.id, type: block.type, options: effectiveOptions(block), data, availability: !blockCatalog[block.type].available || (block.type === "resource_card" && !data) ? "unavailable" : result.availability, stale: result.stale, lastUpdated: result.lastUpdated };
  });
  const data: Overview = { ...base, highlightedResources: resources, problems, screenId: screen.id, presentationRevision: presentation.data.revision, blocks };
  return { ...readResult(data, current.batch, current.keys), presentationStatus: names.status };
}
export async function readHistory(resource: History["resource"], window: History["window"] = "1h", signal?: AbortSignal) {
  let target = resource;
  let generation: string | null = null;
  let presentation: ResourceConfig["presentation"] | undefined;
  if (resource.type === "configured_resource") {
    const config = await getResource(resource.reference!);
    presentation = config.presentation;
    const inventory = await readInventory(config.resourceType === "docker_container" ? [config.zabbixHostKey] : [], [snapshotKeys.bindings]);
    generation = inventory.batch.generation;
    const resolution = resolveResource(config, inventory);
    if (!resolution.resolved || !resolution.target) return queryHistory(resource, window, undefined, { signal, stale: readResult(null, inventory.batch, inventory.keys).stale });
    target = { type: config.resourceType, hostKey: config.zabbixHostKey, reference: "reference" in resolution.target ? resolution.target.reference : null };
  } else {
    const host = (await readHost(resource.hostKey)).data;
    if (resource.type === "vm" && !host.vms.some(vm => vm.vmKey === resource.reference)) throw new BffError(404, "vm_not_found");
  }
  const batch = await readSnapshotBatch([snapshotKeys.bindings]);
  if (generation && batch.generation !== generation) throw new BffError(503, "snapshot_inconsistent");
  const bindings = snapshotData(batch, snapshotKeys.bindings, sourceBindingsSchema, {});
  let source = bindings[sourceKey(target.type, target.hostKey, target.reference)];
  if (source && presentation) {
    const p = presentation;
    source = { ...source, bindings: source.bindings.filter(binding => binding.kind === "numeric" ? visibleMetric(binding.key, p) : !!p.showHealthTimeline && !!p.showHealth && (binding.kind === "health" || p.showStatus)) };
  }
  return queryHistory(resource, window, source, { signal, stale: readResult(null, batch, [snapshotKeys.bindings]).stale });
}
