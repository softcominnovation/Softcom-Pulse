import { RE2JS } from "re2js";

export const MAX_SELECTOR_LENGTH = 256;
export const MAX_RESOURCE_NAME_LENGTH = 512;
export type SelectorType = "exact_name" | "name_prefix" | "name_contains" | "regex";

export function compileSelector(type: SelectorType, value: string): (name: string) => boolean {
  if (!value.length || value.length > MAX_SELECTOR_LENGTH) throw new Error("Invalid selector length");
  const expression = type === "regex" ? RE2JS.compile(value) : null;
  return name => {
    if (name.length > MAX_RESOURCE_NAME_LENGTH) return false;
    switch (type) {
      case "exact_name": return name === value;
      case "name_prefix": return name === value || name.startsWith(value.endsWith(".") ? value : value + ".");
      case "name_contains": return name.includes(value);
      case "regex": return expression!.test(name);
    }
  };
}

export type ResourceSelector = { resourceType: "host" | "docker_container"; zabbixHostKey: string; selectorType: SelectorType | null; selectorValue: string | null };
export type Resolution<T> = { resolved: true; resolution: "resolved"; target: T } | { resolved: false; resolution: "missing" | "ambiguous"; target: null };

export function resolveResource<H extends { hostKey: string }, C extends { hostKey: string; name: string }>(
  config: ResourceSelector, inventory: { hosts: H[]; containers: C[] },
): Resolution<H | C> {
  let candidates: (H | C)[];
  if (config.resourceType === "host") candidates = inventory.hosts.filter(host => host.hostKey === config.zabbixHostKey);
  else {
    if (!config.selectorType || !config.selectorValue) return { resolved: false, resolution: "missing", target: null };
    const matches = compileSelector(config.selectorType, config.selectorValue);
    candidates = inventory.containers.filter(container => container.hostKey === config.zabbixHostKey && matches(container.name));
  }
  if (candidates.length === 1) return { resolved: true, resolution: "resolved", target: candidates[0] };
  return { resolved: false, resolution: candidates.length ? "ambiguous" : "missing", target: null };
}
