import "server-only";
import { Prisma } from "../../../generated/prisma/client.ts";
import { ZodError } from "zod";
import { vmConfigSchema, vmKeySchema, vmWriteSchema, type VmDisplayConfig } from "../../config/vms.ts";
import { BffError } from "../bff.ts";
import { getPrisma } from "../prisma.ts";
import { readInventory } from "../monitoring/inventory.ts";
import { isVmTemplate, virtualizationType } from "../monitoring/virtual-machines.ts";
import { readResult, snapshotKeys } from "../cache/snapshots.ts";

const fields = Prisma.sql`vm_key AS "vmKey", host_key AS "hostKey", vm_id AS "vmId", virtualization_type AS "virtualizationType", original_name AS "originalName", display_name AS "displayName", revision, created_at AS "createdAt", updated_at AS "updatedAt"`;
type Row = Omit<VmDisplayConfig, "createdAt" | "updatedAt"> & { createdAt: Date; updatedAt: Date };
const result = (row: Row) => vmConfigSchema.parse({ ...row, createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString() });
async function database<T>(action: () => Promise<T>) {
  try { return await action(); }
  catch (error) { if (error instanceof BffError || error instanceof ZodError) throw error; throw new BffError(503, "database_unavailable"); }
}
export function listVmConfigs() {
  return database(async () => (await getPrisma().$queryRaw<Row[]>`SELECT ${fields} FROM vm_display_config ORDER BY host_key, virtualization_type, vm_id`).map(result));
}
export function saveVmConfig(vmKey: string, body: unknown) {
  vmKeySchema.parse(vmKey);
  const input = vmWriteSchema.parse(body);
  return database(() => getPrisma().$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(734021006::bigint)`;
    const [current] = await tx.$queryRaw<Row[]>`SELECT ${fields} FROM vm_display_config WHERE vm_key = ${vmKey}`;
    if ((current?.revision ?? 0) !== input.expectedRevision) throw new BffError(409, "revision_conflict");
    if (current) {
      const [updated] = await tx.$queryRaw<Row[]>`UPDATE vm_display_config SET display_name = ${input.displayName}, revision = revision + 1, updated_at = CURRENT_TIMESTAMP WHERE vm_key = ${vmKey} RETURNING ${fields}`;
      return result(updated);
    }
    const inventory = await readInventory();
    const status = readResult(null, inventory.batch, [snapshotKeys.hosts]);
    if (status.stale || status.availability !== "ready") throw new BffError(409, "vm_inventory_unavailable");
    const vm = inventory.hosts.filter(host => host.role === "hypervisor").flatMap(host => host.vms.filter(vm => vm.parentHostKey === host.hostKey)).find(vm => vm.vmKey === vmKey && !isVmTemplate(vm));
    if (!vm) throw new BffError(404, "vm_not_found");
    const type = virtualizationType(vm);
    if (!type) throw new BffError(409, "vm_identity_unverified");
    const [created] = await tx.$queryRaw<Row[]>`INSERT INTO vm_display_config (vm_key, host_key, vm_id, virtualization_type, original_name, display_name) VALUES (${vmKey}, ${vm.parentHostKey}, ${vm.vmId}, ${type}, ${vm.name}, ${input.displayName}) RETURNING ${fields}`;
    return result(created);
  }, { maxWait: 3000, timeout: 5000 }));
}
