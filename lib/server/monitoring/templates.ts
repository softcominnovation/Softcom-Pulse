import "server-only";
import type { Template } from "../../monitoring/templates.ts";
import { BffError } from "../bff.ts";
import { readResult, snapshotKeys } from "../cache/snapshots.ts";
import { listTemplateConfigs } from "../config/templates.ts";
import { readInventory } from "./inventory.ts";
import { isVmTemplate, virtualizationType } from "./virtual-machines.ts";

export async function readTemplates(options: { hostKey?: string; templateKey?: string } = {}) {
  const [inventory, configs] = await Promise.all([readInventory(), listTemplateConfigs()]);
  const byKey = new Map(configs.map(config => [config.templateKey, config]));
  const templates: Template[] = inventory.hosts.filter(host => !options.hostKey || host.hostKey === options.hostKey).flatMap(host => host.vms.filter(isVmTemplate).map(vm => {
    const config = byKey.get(vm.vmKey) ?? null;
    return {
      templateKey: vm.vmKey, hostKey: vm.parentHostKey, templateId: vm.vmId, technicalName: vm.name,
      displayName: config?.displayName ?? vm.name, virtualizationType: virtualizationType(vm),
      role: config?.roleOverride ?? (vm.name.toLowerCase().includes("worker") ? "worker" : "manager"),
      roleSource: config?.roleOverride ? "configuration" : "name_convention",
      memoryBytes: vm.metrics.memoryTotalBytes ?? null, virtualCpuCount: null, diskBytes: vm.metrics.diskTotalBytes ?? null,
      operatingSystem: null, state: vm.state, evidence: vm.evidence, configuration: config,
    };
  }));
  templates.sort((a, b) => a.hostKey.localeCompare(b.hostKey) || a.technicalName.localeCompare(b.technicalName) || a.templateKey.localeCompare(b.templateKey));
  const selected = options.templateKey ? templates.find(template => template.templateKey === options.templateKey) : templates;
  if (!selected) throw new BffError(404, "template_not_found");
  return readResult(selected, inventory.batch, [snapshotKeys.hosts]);
}
