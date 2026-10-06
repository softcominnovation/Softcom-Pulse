import "server-only";
import { hostSchema, containerSchema, problemSchema, type Container, type Problem, type Summary, type VirtualMachine } from "../../monitoring/contracts.ts";
import { tag, type Item, type ZabbixHost, type ZabbixProblem } from "./types.ts";
import { keyParts, metric, observationContext, observedText, opaqueReference } from "./observations.ts";
import { mapMetrics, provisionedCpuMaster, stateBinding } from "./mapping.ts";
import { sourceKey, type SourceBindings, type Binding } from "./bindings.ts";
import { correlatedHost, type MonitoringScope } from "./scope.ts";

export type Trigger = { triggerid: string; hosts: { host: string }[]; items: { itemid: string }[] };
export function normalizeInventory(rawHosts: ZabbixHost[], items: Item[], asgardHostKey: string, vmLinks: MonitoringScope["vmLinks"], now = Date.now()) {
  const context = observationContext(items, now), bindings: SourceBindings = {}, itemResources = new Map<string, Problem["resource"]>();
  const containers: Container[] = [];
  const dockerCounts: { running: number | null; stopped: number | null; total: number | null }[] = [];
  const evidence = (item?: Item) => { const e = context.evidence(item); return { source: "zabbix" as const, observedAt: e.observedAt, validUntil: e.validUntil, basis: item ? "item" as const : "unknown" as const }; };
  const record = (type: "host" | "vm" | "docker_container", hostKey: string, reference: string | null, relevant: Item[], list: Binding[]) => {
    bindings[sourceKey(type, hostKey, reference)] = { identity: reference ?? opaqueReference("host", hostKey), bindings: list };
    for (const item of relevant) itemResources.set(item.itemid, { type, hostKey, reference });
  };
  const hosts = rawHosts.map(raw => {
    const own = items.filter(item => item.hostid === raw.hostid && item.itemDiscovery?.status !== "1");
    const hypervisor = raw.host === asgardHostKey;
    const nodeNames = [...new Set(own.filter(i => i.key_.startsWith("proxmox.node.cpu[")).map(i => keyParts(i.key_).args[0]))];
    const node = nodeNames.includes(raw.host) ? raw.host : nodeNames.length === 1 ? nodeNames[0] : null;
    const hostItems = own.filter(i => hypervisor ? i.key_.startsWith("proxmox.node.") && keyParts(i.key_).args[0] === node && keyParts(i.key_).args.length === 1 : !/^(docker\.|proxmox\.|net.if\.|vfs.fs\.)/.test(i.key_));
    const mapped = mapMetrics(hostItems, context);
    if (!hypervisor && !mapped.metrics.memoryUsedBytes) {
      const total = mapped.metrics.memoryTotalBytes, availableItem = own.find(i => i.key_ === "vm.memory.size[available]" && i.units === "B");
      const available = metric(availableItem, "bytes", context);
      if (total) mapped.metrics.memoryUsedBytes = { value: total.value !== null && available.value !== null && total.value >= available.value ? total.value - available.value : null, unit: "bytes", quality: total.quality === "fresh" && available.quality === "fresh" ? "fresh" : total.quality === "unsupported" || available.quality === "unsupported" ? "unsupported" : total.value === null || available.value === null ? "missing" : "stale", observedAt: total.observedAt && available.observedAt ? [total.observedAt, available.observedAt].sort()[0] : null, validUntil: total.validUntil && available.validUntil ? [total.validUntil, available.validUntil].sort()[0] : null };
    }
    const devices = (category: "filesystems" | "interfaces" | "storages") => {
      const selected = own.filter(i => category === "filesystems" ? /^vfs.fs.(dependent.size|size)\[/.test(i.key_) : category === "interfaces" ? /^net.if.(in|out)\[/.test(i.key_) : hypervisor && /^proxmox.node.(disk|maxdisk)\[/.test(i.key_) && keyParts(i.key_).args[0] === node);
      const groups = new Map<string, Item[]>();
      for (const item of selected) { const args = keyParts(item.key_).args; const name = args[category === "storages" ? 1 : 0]; if (name) groups.set(name, [...(groups.get(name) ?? []), item]); }
      return [...groups].map(([name, group]) => { const key = opaqueReference("device", raw.host, category, name); const d = mapMetrics(group, context, category + "." + key + "."); mapped.bindings.push(...d.bindings); return { key, name, metrics: d.metrics }; });
    };
    const filesystems = devices("filesystems"), interfaces = devices("interfaces"), storages = devices("storages");
    const root = filesystems.find(d => d.name === "/");
    if (root) Object.assign(mapped.metrics, root.metrics);
    const availabilityItem = own.find(i => hypervisor ? i.key_ === `proxmox.node.online[${node}]` : i.key_ === "zabbix[host,agent,available]") ?? own.find(i => !hypervisor && i.key_ === "agent.ping");
    const state = observedText(availabilityItem, context);
    const availability = state === "1" ? "reachable" : state === "0" && hypervisor || state === "2" && availabilityItem?.key_ === "zabbix[host,agent,available]" ? "unreachable" : "unknown";
    const vms: VirtualMachine[] = [];
    if (hypervisor) {
      const groups = new Map<string, Item[]>();
      for (const item of own) if (/^proxmox\.(qemu|lxc)\./.test(item.key_) && !item.key_.startsWith("proxmox.qemu.cpus[") && tag(item.tags, "node") === node) {
        const vmId = keyParts(item.key_).args[0];
        if (/^(qemu|lxc)\/\d+$/.test(vmId ?? "")) groups.set(vmId, [...(groups.get(vmId) ?? []), item]);
      }
      for (const item of own) {
        const master = provisionedCpuMaster(item, context);
        if (!master || tag(master.tags, "node") !== node) continue;
        const group = groups.get(keyParts(master.key_).args[0]);
        if (group) group.push(item);
      }
      for (const [vmId, group] of groups) {
        const vmKey = opaqueReference("vm", raw.host, vmId), vmStateItem = group.find(i => keyParts(i.key_).base.endsWith(".vmstatus"));
        const vmState = observedText(vmStateItem, context), m = mapMetrics(group, context), sb = stateBinding(vmStateItem, "status", context);
        if (sb) m.bindings.push(sb);
        vms.push({ vmKey, vmId: vmId.split('/')[1], name: tag(group[0].tags, "name") ?? vmId, parentHostKey: raw.host, state: ["running", "stopped", "paused"].includes(vmState ?? "") ? vmState as VirtualMachine["state"] : "unknown", metrics: m.metrics, linuxHostKey: correlatedHost(raw.host, vmId, rawHosts, vmLinks), evidence: evidence(vmStateItem) });
        record("vm", raw.host, vmKey, group, m.bindings);
      }
    }
    const host = hostSchema.parse({ hostKey: raw.host, name: raw.name, role: hypervisor ? "hypervisor" : "linux", availability, metrics: mapped.metrics, filesystems, interfaces, storages, vms, evidence: evidence(availabilityItem) });
    record("host", raw.host, null, own.filter(i => !itemResources.has(i.itemid)), mapped.bindings);
    const groups = new Map<string, Item[]>();
    for (const item of own) if (/^docker\.(container_info|container_stats|networks)[.[]/.test(item.key_)) {
      const name = keyParts(item.key_).args[0]?.replace(/^\//, "");
      if (name) groups.set(name, [...(groups.get(name) ?? []), item]);
    }
    for (const [name, group] of groups) {
      const find = (base: string) => group.find(i => keyParts(i.key_).base === base);
      const created = find("docker.container_info.created");
      const reference = opaqueReference("container", raw.host, name, created?.lastvalue || group.map(i => i.itemid).sort().join(","));
      const statusItem = find("docker.container_info.state.status"), healthItem = find("docker.container_info.state.health");
      const status = observedText(statusItem, context), healthValue = observedText(healthItem, context), healthEvidence = context.evidence(healthItem);
      const healthMap = healthItem?.valuemap && !Array.isArray(healthItem.valuemap) ? healthItem.valuemap.mappings : [];
      const verified = ["starting", "unhealthy", "healthy", "none"].every((value, i) => healthMap.some(m => m.type === "0" && m.value === String(i + 1) && m.newvalue.toLowerCase() === value));
      const health = verified ? ({ "1": "starting", "2": "unhealthy", "3": "healthy", "4": "not_configured" } as const)[healthValue ?? ""] ?? "unknown" : "unknown";
      const m = mapMetrics(group, context);
      const started = find("docker.container_info.started"), startValue = observedText(started, context);
      if (startValue && status === "running" && Number(startValue) > 0 && Number(startValue) * 1000 <= now) {
        const e = context.evidence(started);
        m.metrics.uptimeSeconds = { value: Math.floor(now / 1000) - Number(startValue), unit: "seconds", quality: "fresh", observedAt: e.observedAt, validUntil: e.validUntil };
      }
      for (const [item, kind] of [[statusItem, "status"], [verified ? healthItem : undefined, "health"]] as const) { const b = stateBinding(item, kind, context); if (b) m.bindings.push(b); }
      const container = containerSchema.parse({ reference, hostKey: raw.host, name, image: observedText(find("docker.container_info.image"), context), status: status === "exited" ? "stopped" : ["running", "stopped", "paused", "restarting", "created", "removing", "dead"].includes(status ?? "") ? status : "unknown", health,
        healthReason: health !== "unknown" ? "observed" : healthEvidence.quality === "fresh" ? "unrecognized" : healthEvidence.quality,
        healthObservedAt: healthEvidence.observedAt, healthValidUntil: healthEvidence.validUntil, metrics: m.metrics, evidence: evidence(statusItem) });
      containers.push(container); record("docker_container", raw.host, reference, group, m.bindings);
    }
    if (own.some(item => item.key_.startsWith("docker."))) {
      const count = (key: string) => { const value = metric(own.find(i => i.key_ === key), "count", context); return value.quality === "fresh" && Number.isInteger(value.value) ? value.value : null; };
      dockerCounts.push({ running: count("docker.containers.running"), stopped: count("docker.containers.stopped"), total: count("docker.containers.total") });
    }
    return host;
  });
  return { hosts, containers, bindings, itemResources, dockerCounts };
}
export function normalizeProblems(problems: ZabbixProblem[], triggers: Trigger[], inventory: ReturnType<typeof normalizeInventory>): Problem[] {
  const byId = new Map(triggers.map(trigger => [trigger.triggerid, trigger]));
  return problems.flatMap(problem => {
    const trigger = byId.get(problem.objectid);
    if (!trigger) throw new Error("problem_mapping_incomplete");
    const related = new Map<string, Problem["resource"]>();
    for (const item of trigger.items) { const resource = inventory.itemResources.get(item.itemid); if (resource) related.set(JSON.stringify(resource), resource); }
    if (!related.size) for (const host of trigger.hosts) if (inventory.hosts.some(h => h.hostKey === host.host)) { const r = { type: "host" as const, hostKey: host.host, reference: null }; related.set(JSON.stringify(r), r); }
    return [...related.values()].map(resource => problemSchema.parse({ id: opaqueReference("problem", problem.eventid, JSON.stringify(resource)), resource, description: problem.name, severity: Number(problem.severity), visualState: Number(problem.severity) >= 4 ? "critical" : Number(problem.severity) >= 2 ? "warning" : "info", startedAt: new Date(Number(problem.clock) * 1000).toISOString() }));
  });
}
export function summarize(inventory: ReturnType<typeof normalizeInventory>, problems: Problem[], criticalAffected: number | null): Summary {
  const count = (field: "running" | "stopped" | "total") => inventory.dockerCounts.length && inventory.dockerCounts.every(c => c[field] !== null) ? inventory.dockerCounts.reduce((n, c) => n + c[field]!, 0) : null;
  return { hostsKnown: inventory.hosts.length, hostsReachable: inventory.hosts.some(h => h.availability === "unknown") ? null : inventory.hosts.filter(h => h.availability === "reachable").length, vms: inventory.hosts.reduce((n, h) => n + h.vms.length, 0), containersRunning: count("running"), containersStopped: count("stopped"), containersTotal: count("total"), problems: new Set(problems.map(p => p.id)).size, criticalAffected };
}
