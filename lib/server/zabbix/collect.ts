import "server-only";
import { z } from "zod";
import { listResources } from "../config/repository.ts";
import { readScopeSettings, selectScope, assertHypervisor } from "./scope.ts";
import { zabbixCall } from "./client.ts";
import { itemSchema, zabbixHostSchema, zabbixProblemSchema, type Rpc } from "./types.ts";
import { needsValue } from "./mapping.ts";
import { normalizeInventory, normalizeProblems, summarize, type Trigger } from "./normalize.ts";
import { sourceBindingsSchema } from "./bindings.ts";
import { cardResource, configuredResource } from "../monitoring/read.ts";
import { overviewSnapshotSchema } from "../../monitoring/contracts.ts";
import { snapshotKeys } from "../cache/snapshots.ts";
import { discoverAgentCandidates, type AgentDiscovery } from "./discovery.ts";
import { BffError } from "../bff.ts";

const hostOutput = ["hostid", "host", "name", "status"];
const itemOutput = ["itemid", "hostid", "name", "key_", "type", "value_type", "units", "delay", "status", "state", "lastclock", "master_itemid"];
const triggerSchema = z.object({
  triggerid: z.string(),
  status: z.string(),
  hosts: z.array(z.object({ host: z.string() })),
  items: z.array(z.object({ itemid: z.string() })),
});

/** Keep only problems whose trigger exists and is enabled (status "0"). Disabled/missing triggers are not operational. */
export function selectActiveProblems<T extends { objectid: string }>(
  problems: T[],
  triggers: { triggerid: string; status: string }[],
): T[] {
  const statusById = new Map(triggers.map(trigger => [trigger.triggerid, trigger.status]));
  return problems.filter(problem => statusById.get(problem.objectid) === "0");
}

export async function collectSnapshots(options: {
  rpc?: Rpc;
  scope?: Awaited<ReturnType<typeof readScopeSettings>>;
  configs?: Awaited<ReturnType<typeof listResources>>;
  signal?: AbortSignal;
  now?: number;
  /** When false, skips the light discovery host.get (Collector throttles via PULSE_DISCOVERY_EVERY_N_CYCLES). Default true. */
  discover?: boolean;
} = {}) {
  const rpc = options.rpc ?? zabbixCall, signal = options.signal;
  const runDiscovery = options.discover !== false;
  const settings = options.scope ?? await readScopeSettings();
  const configs = options.configs ?? await listResources();
  const rawHosts = z.array(zabbixHostSchema).parse(await rpc("host.get", {
    output: hostOutput, ...(settings.scope ? { filter: { host: settings.scope.hostKeys } } : {}),
    selectTags: ["tag", "value"], selectHostGroups: ["name"], selectInterfaces: ["type", "main", "available"], limit: 501,
  }, signal));
  if (rawHosts.length > 500) throw new BffError(503, "monitoring_scope_too_large");
  const scope = selectScope(rawHosts, settings), hostids = scope.hosts.map(h => h.hostid);
  const metadata = z.array(itemSchema).parse(await rpc("item.get", { hostids, output: itemOutput, selectTags: ["tag", "value"], selectPreprocessing: ["type", "params"], selectValueMap: "extend", selectItemDiscovery: ["status"], limit: 20001 }, signal));
  if (metadata.length > 20000) throw new BffError(503, "monitoring_inventory_too_large");
  assertHypervisor(metadata, scope.hosts.find(h => h.host === scope.asgardHostKey)!.hostid);
  const selected = metadata.filter(needsValue);
  const values = z.array(z.object({ itemid: z.string(), lastvalue: z.string(), lastclock: z.string(), state: z.string() })).parse(await rpc("item.get", { itemids: selected.map(i => i.itemid), output: ["itemid", "lastvalue", "lastclock", "state"], limit: 20001 }, signal));
  if (values.length !== selected.length) throw new BffError(503, "zabbix_cycle_incomplete");
  const byId = new Map(values.map(i => [i.itemid, i]));
  if (selected.some(i => !byId.has(i.itemid))) throw new BffError(503, "zabbix_cycle_incomplete");
  const items = metadata.map(item => ({ ...item, ...byId.get(item.itemid) }));
  const inventory = normalizeInventory(scope.hosts, items, scope.asgardHostKey, scope.vmLinks, options.now);
  const rawProblems = z.array(zabbixProblemSchema).parse(await rpc("problem.get", { hostids, source: 0, object: 0, recent: false, output: ["eventid", "objectid", "name", "severity", "clock"], selectTags: ["tag", "value"], limit: 5001 }, signal));
  if (rawProblems.length > 5000) throw new BffError(503, "zabbix_problems_too_large");
  const triggerids = [...new Set(rawProblems.map(problem => problem.objectid))];
  const triggerRows = rawProblems.length
    ? z.array(triggerSchema).parse(await rpc("trigger.get", { triggerids, output: ["triggerid", "status"], selectHosts: ["host"], selectItems: ["itemid"] }, signal))
    : [];
  const activeProblems = selectActiveProblems(rawProblems, triggerRows);
  const triggers: Trigger[] = triggerRows
    .filter(trigger => trigger.status === "0")
    .map(({ triggerid, hosts, items }) => ({ triggerid, hosts, items }));
  const problems = normalizeProblems(activeProblems, triggers, inventory);
  const resources = configs.filter(c => c.enabled && c.dashboardEnabled).map(config => configuredResource(config, inventory));
  const highlighted = resources.map(resource => cardResource(resource, inventory.hosts));
  const critical = resources.filter(r => r.config.critical);
  const criticalAffected = critical.some(r => !r.resource || ("availability" in r.resource ? r.resource.availability === "unknown" : r.resource.status === "unknown")) ? null : critical.filter(r => r.resource && ("availability" in r.resource ? r.resource.availability === "unreachable" : r.resource.status !== "running" || r.resource.health === "unhealthy")).length;
  const summary = { ...summarize(inventory, problems, criticalAffected), problems: activeProblems.length };
  const asgard = inventory.hosts.find(h => h.hostKey === scope.asgardHostKey)!;
  const entries: Record<string, unknown> = {
    [snapshotKeys.hosts]: inventory.hosts, [snapshotKeys.problems]: problems,
    [snapshotKeys.overview]: overviewSnapshotSchema.parse({ summary, asgardSummary: { host: asgard, vms: asgard.vms } }),
    [snapshotKeys.bindings]: sourceBindingsSchema.parse(inventory.bindings),
  };
  for (const host of inventory.hosts) { entries[snapshotKeys.host(host.hostKey)] = host; entries[snapshotKeys.containers(host.hostKey)] = inventory.containers.filter(c => c.hostKey === host.hostKey); }
  for (const service of highlighted) entries[snapshotKeys.service(service.id)] = { ...service, status: service.resolution };
  let discovery: AgentDiscovery | null = null;
  if (runDiscovery && settings.scope) {
    try {
      discovery = await discoverAgentCandidates({
        rpc, scope: settings.scope, asgardHostKey: scope.asgardHostKey, inventoryHosts: inventory.hosts, signal,
      });
    } catch (error) {
      const code = error instanceof BffError ? error.code : "discovery_failed";
      console.error(JSON.stringify({ event: "agent_discovery_failed", error: code }));
    }
  }
  return { entries, discovery, counts: { hosts: inventory.hosts.length, vms: summary.vms, containers: inventory.containers.length, problems: activeProblems.length } };
}
