import "server-only";
import { z } from "zod";
import { hostSchema, type VmWorkloads } from "../../monitoring/contracts.ts";
import { BffError } from "../bff.ts";
import { listResources } from "../config/repository.ts";
import { readResult, readSnapshotBatch, snapshotData, snapshotKeys } from "../cache/snapshots.ts";
import { freshness, readInventory } from "./inventory.ts";
import { operationalHost } from "./virtual-machines.ts";
import { configuredResource } from "./read.ts";

export async function readVmWorkloads(parentHostKey: string, vmKey: string, signal?: AbortSignal) {
  for (let attempt = 0; attempt < 3; attempt++) {
    signal?.throwIfAborted();
    const first = await readSnapshotBatch([snapshotKeys.hosts]);
    const hosts = snapshotData(first, snapshotKeys.hosts, z.array(hostSchema), []);
    const parent = hosts.find(host => host.hostKey === parentHostKey && host.role === "hypervisor");
    if (!parent) throw new BffError(404, "host_not_found");
    const vm = operationalHost(parent).vms.find(vm => vm.vmKey === vmKey && vm.parentHostKey === parentHostKey);
    if (!vm) throw new BffError(404, "vm_not_found");
    const base: VmWorkloads = { vm: freshness(vm, readResult(null, first, [snapshotKeys.hosts]).stale), association: "unlinked", containers: [], configuredServices: [] };
    if (!vm.linuxHostKey) return { ...readResult(base, first, [snapshotKeys.hosts]), availability: "unavailable" as const };
    const linked = hosts.find(host => host.hostKey === vm.linuxHostKey && host.role === "linux");
    if (!linked || linked.availability === "unreachable") return { ...readResult({ ...base, association: "host_unavailable" as const }, first, [snapshotKeys.hosts]), availability: "unavailable" as const };
    const current = await readInventory([linked.hostKey]);
    if (current.batch.generation !== first.generation) continue;
    const configs = await listResources({ resourceType: "docker_container", zabbixHostKey: linked.hostKey });
    signal?.throwIfAborted();
    return readResult({ ...base, association: "linked" as const, containers: current.containers,
      configuredServices: configs.map(config => configuredResource(config, current)),
    }, current.batch, [snapshotKeys.containers(linked.hostKey)]);
  }
  throw new BffError(503, "snapshot_inconsistent");
}
