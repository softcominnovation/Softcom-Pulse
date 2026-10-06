import "server-only";
import { randomUUID } from "node:crypto";
import { ZodError } from "zod";
import type { Prisma, MonitoredResourceConfig, PulseSetting } from "../../../generated/prisma/client.ts";
import { resourceInputSchema, resourcePatchSchema, type ResourceConfig } from "../../config/resources.ts";
import { blockCatalog, initialPresentation, presentationDocumentSchema, presentationWriteSchema, type PresentationResult } from "../../config/presentation.ts";
import { BffError } from "../bff.ts";
import { getPrisma } from "../prisma.ts";
import { validateSelection } from "../monitoring/inventory.ts";

const PRESENTATION_KEY = "dashboardPresentation";
type Transaction = Prisma.TransactionClient;
function presentationResult(row: PulseSetting): PresentationResult {
  const parsed = presentationDocumentSchema.safeParse(row.value);
  if (!parsed.success) throw new BffError(503, "configuration_unavailable");
  return { data: parsed.data, updatedAt: row.updatedAt.toISOString() };
}
function resourceResult(row: MonitoredResourceConfig): ResourceConfig {
  const { id, createdAt, updatedAt, ...input } = row;
  const parsed = resourceInputSchema.safeParse(input);
  if (!parsed.success) throw new BffError(503, "configuration_unavailable");
  return { ...parsed.data, id, createdAt: createdAt.toISOString(), updatedAt: updatedAt.toISOString() };
}
async function database<T>(action: () => Promise<T>): Promise<T> {
  try { return await action(); }
  catch (error) {
    if (error instanceof BffError || error instanceof ZodError) throw error;
    const code = (error as { code?: string })?.code;
    if (code === "P2002") throw new BffError(409, "resource_conflict");
    if (code === "P2025") throw new BffError(404, "resource_not_found");
    throw new BffError(503, "database_unavailable");
  }
}
async function transaction<T>(action: (tx: Transaction) => Promise<T>) {
  return database(() => getPrisma().$transaction(async tx => {
    // Serialize configuration writes so presentation validation and resource deletion cannot race.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(734021003::bigint)`;
    return action(tx);
  }, { maxWait: 3000, timeout: 5000 }));
}
async function initialize(tx: Transaction) {
  return tx.pulseSetting.upsert({ where: { key: PRESENTATION_KEY }, update: {}, create: { key: PRESENTATION_KEY, value: initialPresentation(randomUUID) } });
}
export async function getPresentation() {
  return transaction(async tx => presentationResult(await initialize(tx)));
}
export async function savePresentation(body: unknown) {
  const { settings, expectedRevision } = presentationWriteSchema.parse(body);
  return transaction(async tx => {
    const current = presentationResult(await initialize(tx));
    if (current.data.revision !== expectedRevision) throw new BffError(409, "revision_conflict");
    const blocks = settings.screens.flatMap(screen => screen.blocks);
    if (blocks.some(block => !blockCatalog[block.type].available)) throw new BffError(400, "block_unavailable");
    const ids = [...new Set(blocks.flatMap(block => block.resourceConfigId ? [block.resourceConfigId] : []))];
    const valid = await tx.monitoredResourceConfig.count({ where: { id: { in: ids }, enabled: true, dashboardEnabled: true } });
    if (valid !== ids.length) throw new BffError(400, "invalid_resource_reference");
    return presentationResult(await tx.pulseSetting.update({ where: { key: PRESENTATION_KEY }, data: { value: { ...settings, revision: expectedRevision + 1 } } }));
  });
}
export async function listResources(filter?: { resourceType: "docker_container"; zabbixHostKey: string }) {
  return database(async () => (await getPrisma().monitoredResourceConfig.findMany({ where: filter, orderBy: [{ displayOrder: "asc" }, { id: "asc" }] })).map(resourceResult));
}
export async function getResource(id: string) {
  return database(async () => resourceResult(await getPrisma().monitoredResourceConfig.findUniqueOrThrow({ where: { id } })));
}
export async function createResource(body: unknown) {
  const input = resourceInputSchema.parse(body);
  return transaction(async tx => {
    const created = await tx.monitoredResourceConfig.create({ data: input });
    await validateSelection(input);
    return resourceResult(created);
  });
}
export async function updateResource(id: string, body: unknown) {
  const patch = resourcePatchSchema.parse(body);
  return transaction(async tx => {
    const current = await tx.monitoredResourceConfig.findUniqueOrThrow({ where: { id } });
    const fields = Object.fromEntries(Object.entries(current).filter(([key]) => !["id", "createdAt", "updatedAt"].includes(key)));
    const input = resourceInputSchema.parse({ ...fields, ...patch });
    if (["resourceType", "zabbixHostKey", "selectorType", "selectorValue"].some(key => key in patch)) await validateSelection(input);
    return resourceResult(await tx.monitoredResourceConfig.update({ where: { id }, data: input }));
  });
}
export async function deleteResource(id: string) {
  return transaction(async tx => {
    await tx.monitoredResourceConfig.delete({ where: { id } });
    const { data } = presentationResult(await initialize(tx));
    let changed = false;
    const screens = data.screens.map(screen => {
      const blocks = screen.blocks.filter(block => block.resourceConfigId !== id);
      if (blocks.length === screen.blocks.length) return screen;
      changed = true;
      if (!blocks.length || (screen.enabled && !blocks.some(block => block.enabled))) {
        blocks.push({ id: randomUUID(), type: "summary", enabled: true, width: "full" });
      }
      return { ...screen, blocks };
    });
    if (changed) await tx.pulseSetting.update({ where: { key: PRESENTATION_KEY }, data: { value: { ...data, screens, revision: data.revision + 1 } } });
  });
}
