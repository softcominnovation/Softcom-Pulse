import "server-only";
import type { ResourceConfig } from "../../config/resources.ts";
import type { Container, Host } from "../../monitoring/contracts.ts";
import { namesForInventory } from "../../monitoring/display-names.ts";
import { listResources } from "../config/repository.ts";
import { listVmConfigs } from "../config/vms.ts";

export async function readDisplayNames(hosts: Host[], containers: Container[] = [], resources?: ResourceConfig[]) {
  const [configs, vms] = await Promise.allSettled([resources ? Promise.resolve(resources) : listResources(), listVmConfigs()]);
  return namesForInventory(hosts, containers, configs.status === "fulfilled" ? configs.value : [], vms.status === "fulfilled" ? vms.value : [], configs.status === "rejected" || vms.status === "rejected");
}
