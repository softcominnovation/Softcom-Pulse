import { displayName } from "../monitoring/display-names.ts";
import type { Metric, VirtualMachine } from "../monitoring/contracts.ts";
import { sortInventory, unknownEvidence } from "../dashboard/block-options.ts";

export type VmStateFilter = "" | "running" | "paused" | "stopped" | "unknown";
export type VmSortBy = "name" | "cpu" | "memory" | "cpu_memory";

const collator = new Intl.Collator("pt-BR", { sensitivity: "base", numeric: true });

function percentage(metric: Metric | undefined, stale: boolean, now: number) {
  return !stale && metric?.quality === "fresh" && metric.unit === "percent" && metric.value !== null && !!metric.observedAt && !(metric.validUntil !== undefined && (!metric.validUntil || Date.parse(metric.validUntil) < now)) ? metric.value : null;
}

function matchesQuery(vm: VirtualMachine, query: string) {
  if (!query) return true;
  const needle = query.toLocaleLowerCase("pt-BR");
  return vm.name.toLocaleLowerCase("pt-BR").includes(needle) || displayName(vm).toLocaleLowerCase("pt-BR").includes(needle);
}

function effectiveState(vm: VirtualMachine, stale: boolean, now: number): Exclude<VmStateFilter, ""> {
  return unknownEvidence(vm, stale, now) ? "unknown" : vm.state;
}

function sortByCpuAndMemory(vms: VirtualMachine[], direction: "asc" | "desc", stale: boolean, now: number) {
  const sign = direction === "asc" ? 1 : -1;
  return [...vms].sort((a, b) => {
    const score = (vm: VirtualMachine) => {
      const cpu = percentage(vm.metrics.cpuUsagePercent, stale, now);
      const memory = percentage(vm.metrics.memoryUsagePercent, stale, now);
      if (cpu === null && memory === null) return null;
      if (cpu === null) return memory;
      if (memory === null) return cpu;
      return (cpu + memory) / 2;
    };
    const av = score(a), bv = score(b);
    const tie = collator.compare(displayName(a), displayName(b)) || `${a.parentHostKey}:${a.vmKey}`.localeCompare(`${b.parentHostKey}:${b.vmKey}`);
    return av === null ? bv === null ? tie : 1 : bv === null ? -1 : (av - bv) * sign || tie;
  });
}

export function filterAndSortVms(
  vms: VirtualMachine[],
  options: { query: string; state: VmStateFilter; sortBy: VmSortBy; sortDirection: "asc" | "desc" },
  stale: boolean,
  now: number,
) {
  const query = options.query.trim();
  const filtered = vms.filter(vm => matchesQuery(vm, query) && (!options.state || effectiveState(vm, stale, now) === options.state));
  if (options.sortBy === "cpu_memory") return sortByCpuAndMemory(filtered, options.sortDirection, stale, now);
  return sortInventory(filtered, { sortBy: options.sortBy, sortDirection: options.sortDirection }, stale, now);
}
