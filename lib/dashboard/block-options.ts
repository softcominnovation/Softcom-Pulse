import { displayName } from "../monitoring/display-names.ts";
import type { ConfiguredResource, Container, Host, Metric, Problem, VirtualMachine } from "../monitoring/contracts.ts";
import type { OptionsByType } from "../config/presentation.ts";

const collator = new Intl.Collator("pt-BR", { sensitivity: "base", numeric: true });
type Item = Host | VirtualMachine | Container;
export function unknownEvidence(item: Item, stale: boolean, now: number) {
  return stale || !item.evidence.observedAt || (item.evidence.validUntil !== undefined && (!item.evidence.validUntil || Date.parse(item.evidence.validUntil) < now));
}
function percentage(metric: Metric | undefined, stale: boolean, now: number) {
  return !stale && metric?.quality === "fresh" && metric.unit === "percent" && metric.value !== null && !!metric.observedAt && !(metric.validUntil !== undefined && (!metric.validUntil || Date.parse(metric.validUntil) < now)) ? metric.value : null;
}
function identity(item: Item) { return "vmKey" in item ? `${item.parentHostKey}:${item.vmKey}` : `${item.hostKey}:${"reference" in item ? item.reference : ""}`; }
export function sortInventory<T extends Item>(items: T[], options: { sortBy: string; sortDirection: "asc" | "desc" }, stale: boolean, now: number): T[] {
  const sign = options.sortDirection === "asc" ? 1 : -1;
  const value = (item: Item): number | null => {
    if (options.sortBy === "cpu" || options.sortBy === "memory") return percentage(item.metrics[options.sortBy === "cpu" ? "cpuUsagePercent" : "memoryUsagePercent"], stale, now);
    if (unknownEvidence(item, stale, now)) return null;
    if (options.sortBy === "health" && "health" in item) {
      if (item.healthValidUntil !== undefined && (!item.healthValidUntil || Date.parse(item.healthValidUntil) < now)) return null;
      const index = ["unhealthy", "starting", "healthy", "not_configured"].indexOf(item.health); return index < 0 ? null : index;
    }
    const state = "state" in item ? item.state : "status" in item ? item.status : item.availability;
    const order = "state" in item ? ["running", "paused", "stopped"] : "status" in item ? ["running", "paused", "restarting", "created", "stopped", "removing", "dead"] : ["reachable", "unreachable"];
    const index = order.indexOf(state); return index < 0 ? null : index;
  };
  return [...items].sort((a, b) => {
    const byName = collator.compare(displayName(a), displayName(b)), tie = byName || identity(a).localeCompare(identity(b));
    if (options.sortBy === "name") return byName * sign || identity(a).localeCompare(identity(b));
    const av = value(a), bv = value(b);
    return av === null ? bv === null ? tie : 1 : bv === null ? -1 : (av - bv) * sign || tie;
  });
}
export function selectVms(items: VirtualMachine[], options: OptionsByType["asgard_summary"], stale: boolean, now: number) {
  return sortInventory(items.filter(vm => options.states.includes(unknownEvidence(vm, stale, now) ? "unknown" : vm.state)), options, stale, now);
}
export function selectProblems(items: Problem[], options: OptionsByType["problems"]) {
  const sign = options.sortDirection === "asc" ? 1 : -1;
  return items.filter(item => options.severities.includes(item.severity)).sort((a, b) => (options.sortBy === "severity" ? (a.severity - b.severity) * sign || b.startedAt.localeCompare(a.startedAt) : a.startedAt.localeCompare(b.startedAt) * sign) || a.id.localeCompare(b.id));
}
export function selectHighlights(items: ConfiguredResource[], options: OptionsByType["highlighted_resources"]) {
  const sign = options.sortDirection === "asc" ? 1 : -1;
  return items.filter(item => !options.criticalOnly || item.config.critical).sort((a, b) => (options.sortBy === "configured" ? a.config.displayOrder - b.config.displayOrder : collator.compare(a.config.displayName ?? a.resource?.name ?? a.config.zabbixHostKey, b.config.displayName ?? b.resource?.name ?? b.config.zabbixHostKey)) * sign || a.id.localeCompare(b.id));
}
