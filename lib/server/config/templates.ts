import "server-only";
import { Prisma } from "../../../generated/prisma/client.ts";
import { ZodError } from "zod";
import { templateConfigSchema, templateKeySchema, templateWriteSchema, type TemplateConfig } from "../../config/templates.ts";
import { BffError } from "../bff.ts";
import { getPrisma } from "../prisma.ts";
import { readInventory } from "../monitoring/inventory.ts";
import { isVmTemplate, virtualizationType } from "../monitoring/virtual-machines.ts";
import { readResult, snapshotKeys } from "../cache/snapshots.ts";

const fields = Prisma.sql`template_key AS "templateKey", host_key AS "hostKey", template_id AS "templateId", virtualization_type AS "virtualizationType", original_name AS "originalName", display_name AS "displayName", role_override AS "roleOverride", revision, created_at AS "createdAt", updated_at AS "updatedAt"`;
type Row = Omit<TemplateConfig, "createdAt" | "updatedAt"> & { createdAt: Date; updatedAt: Date };
function result(row: Row) { return templateConfigSchema.parse({ ...row, createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString() }); }
async function database<T>(action: () => Promise<T>) {
  try { return await action(); }
  catch (error) {
    if (error instanceof BffError || error instanceof ZodError) throw error;
    throw new BffError(503, "database_unavailable");
  }
}
export function listTemplateConfigs() {
  return database(async () => (await getPrisma().$queryRaw<Row[]>`SELECT ${fields} FROM vm_template_config ORDER BY host_key, virtualization_type, template_id`).map(result));
}
export function saveTemplateConfig(templateKey: string, body: unknown) {
  templateKeySchema.parse(templateKey);
  const input = templateWriteSchema.parse(body);
  return database(() => getPrisma().$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(734021005::bigint)`;
    const [current] = await tx.$queryRaw<Row[]>`SELECT ${fields} FROM vm_template_config WHERE template_key = ${templateKey}`;
    if ((current?.revision ?? 0) !== input.expectedRevision) throw new BffError(409, "revision_conflict");
    if (current) {
      const [updated] = await tx.$queryRaw<Row[]>`UPDATE vm_template_config SET display_name = ${input.displayName}, role_override = ${input.roleOverride}, revision = revision + 1, updated_at = CURRENT_TIMESTAMP WHERE template_key = ${templateKey} RETURNING ${fields}`;
      return result(updated);
    }
    const inventory = await readInventory();
    const status = readResult(null, inventory.batch, [snapshotKeys.hosts]);
    if (status.stale || status.availability !== "ready") throw new BffError(409, "template_inventory_unavailable");
    const vm = inventory.hosts.flatMap(host => host.vms).find(vm => vm.vmKey === templateKey && isVmTemplate(vm));
    if (!vm) throw new BffError(404, "template_not_found");
    const type = virtualizationType(vm);
    if (!type) throw new BffError(409, "template_identity_unverified");
    const [created] = await tx.$queryRaw<Row[]>`INSERT INTO vm_template_config (template_key, host_key, template_id, virtualization_type, original_name, display_name, role_override) VALUES (${templateKey}, ${vm.parentHostKey}, ${vm.vmId}, ${type}, ${vm.name}, ${input.displayName}, ${input.roleOverride}) RETURNING ${fields}`;
    return result(created);
  }, { maxWait: 3000, timeout: 5000 }));
}
