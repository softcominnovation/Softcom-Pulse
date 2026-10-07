import type { ResourceConfig } from "../config/resources.ts";
import type { VmDisplayConfig } from "../config/vms.ts";
import type { Container, Host, Problem, VirtualMachine } from "./contracts.ts";
import { resolveResource } from "./selectors.ts";

export function displayName(item: { name: string; displayName?: string }) { return item.displayName ?? item.name; }
export function namesForInventory(hosts: Host[], containers: Container[], resources: ResourceConfig[], vms: VmDisplayConfig[], unavailable = false) {
  const vmConfigs = new Map(vms.map(config => [config.vmKey, config]));
  const key = (item: Host | Container) => JSON.stringify([item.hostKey, "reference" in item ? item.reference : null]);
  const matches = new Map<string, ResourceConfig[]>();
  for (const config of resources) {
    const resolution = resolveResource(config, { hosts, containers });
    if (resolution.resolved) { const id = key(resolution.target); matches.set(id, [...(matches.get(id) ?? []), config]); }
  }
  function resource<T extends Host | Container>(item: T): T {
    const configs = matches.get(key(item)) ?? [];
    const labels = [...new Set(configs.filter(config => config.enabled && config.displayName).map(config => config.displayName!))];
    return { ...item, displayName: labels.length === 1 ? labels[0] : item.name, presentationStatus: unavailable ? "unavailable" : "ready", nameConflict: labels.length > 1,
      resourceConfigurations: configs.map(config => ({ id: config.id, displayName: config.displayName, enabled: config.enabled, dashboardEnabled: config.dashboardEnabled })) };
  }
  function vm(item: VirtualMachine): VirtualMachine {
    const config = vmConfigs.get(item.vmKey);
    return { ...item, displayName: config?.hostKey === item.parentHostKey && config.vmId === item.vmId ? config.displayName ?? item.name : item.name, presentationStatus: unavailable ? "unavailable" : "ready" };
  }
  const host = (item: Host): Host => ({ ...resource(item), vms: item.vms.map(vm) });
  function problem(item: Problem): Problem {
    const parent = hosts.find(host => host.hostKey === item.resource.hostKey);
    const machine = item.resource.type === "vm" ? parent?.vms.find(vm => vm.vmKey === item.resource.reference) : undefined;
    const target = machine ? vm(machine) : item.resource.type === "host" && parent ? host(parent) : item.resource.type === "docker_container" ? containers.find(container => container.hostKey === item.resource.hostKey && container.reference === item.resource.reference) : undefined;
    const label = target && ("reference" in target ? displayName(resource(target)) : displayName(target));
    return label ? { ...item, resourceDisplayName: label } : item;
  }
  return { host, vm, container: resource<Container>, problem, status: unavailable ? "unavailable" as const : "ready" as const };
}
