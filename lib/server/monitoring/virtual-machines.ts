import "server-only";
import type { Host, Problem, VirtualMachine } from "../../monitoring/contracts.ts";
import { opaqueReference } from "../zabbix/observations.ts";

export function isVmTemplate(vm: VirtualMachine) { return vm.name.startsWith("tpl"); }
export function virtualizationType(vm: VirtualMachine): "qemu" | "lxc" | null {
  if (!vm.vmId || !/^\d+$/.test(vm.vmId)) return null;
  return (["qemu", "lxc"] as const).find(type => opaqueReference("vm", vm.parentHostKey, `${type}/${vm.vmId}`) === vm.vmKey) ?? null;
}
export function operationalHost(host: Host): Host { return { ...host, vms: host.vms.filter(vm => !isVmTemplate(vm)) }; }
export function operationalProblems(problems: Problem[], hosts: Host[]): Problem[] {
  const machines = new Map(hosts.flatMap(host => host.vms.map(vm => [JSON.stringify([host.hostKey, vm.vmKey]), vm] as const)));
  return problems.flatMap(problem => {
    const vm = problem.resource.type === "vm" ? machines.get(JSON.stringify([problem.resource.hostKey, problem.resource.reference])) : undefined;
    if (!vm) return [problem];
    if (isVmTemplate(vm)) return [];
    const type = virtualizationType(vm);
    const prefix = `Proxmox VE: VM [${vm.parentHostKey}/${vm.name} (${type}/${vm.vmId})]`;
    if (!type || !problem.description.startsWith(prefix)) return [problem];
    const suffix = problem.description.slice(prefix.length);
    if (!/^(?::\s+|\s+)\S/.test(suffix)) return [problem];
    return [{ ...problem, displayDescription: `${vm.name} (${vm.vmId}) · ${suffix.replace(/^:\s*|^\s+/, "")}` }];
  });
}
