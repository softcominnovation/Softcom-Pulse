import "server-only";
import { Prisma } from "../../../generated/prisma/client.ts";
import { ZodError } from "zod";
import { storageConfigSchema, storageKeySchema, storageWriteSchema, type StorageConfig } from "../../config/storages.ts";
import { getPrisma } from "../prisma.ts";
import { BffError } from "../bff.ts";
import { readSnapshotBatch, snapshotData, snapshotKeys, snapshotTiming } from "../cache/snapshots.ts";
import { storageSnapshotSchema, type StorageTechnical } from "../../storage/contracts.ts";
import { storageKey as identityKey } from "../zabbix/storage.ts";

function result(row: { createdAt: Date; updatedAt: Date }) {
  return storageConfigSchema.parse({ ...row, createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString() });
}
async function database<T>(action: () => Promise<T>) {
  try { return await action(); }
  catch (error) {
    if (error instanceof BffError || error instanceof ZodError) throw error;
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") throw new BffError(409, "revision_conflict");
    throw new BffError(503, "database_unavailable");
  }
}
export const listStorageConfigs = (): Promise<StorageConfig[]> => database(async () => (await getPrisma().storageConfig.findMany({ orderBy: [{ displayOrder: "asc" }, { id: "asc" }] })).map(result));
export function saveStorageConfig(key: string, body: unknown) {
  storageKeySchema.parse(key);
  const input = storageWriteSchema.parse(body);
  return database(() => getPrisma().$transaction(async tx => {
    const current = await tx.storageConfig.findUnique({ where: { storageKey: key } });
    if ((current?.revision ?? 0) !== input.expectedRevision) throw new BffError(409, "revision_conflict");
    const selectionChanged = JSON.stringify(current?.filesystemKeys ?? null) !== JSON.stringify(input.filesystemKeys) || (current?.networkInterfaceKey ?? null) !== input.networkInterfaceKey;
    let source: StorageTechnical | undefined;
    if (!current || selectionChanged && (input.filesystemKeys !== null || input.networkInterfaceKey !== null)) {
      const batch = await readSnapshotBatch([snapshotKeys.storages]).catch(() => { throw new BffError(409, "storage_inventory_unavailable"); });
      const snapshot = snapshotData(batch, snapshotKeys.storages, storageSnapshotSchema.nullable(), null);
      if (!snapshot || snapshot.status !== "ok" || batch.sync?.status !== "ok" || !snapshot.lastSuccessfulAt || Date.now() - Date.parse(snapshot.lastSuccessfulAt) >= snapshotTiming().staleAfter) throw new BffError(409, "storage_inventory_unavailable");
      source = snapshot.items.find(item => item.storageKey === key);
      if (!source) throw new BffError(current ? 409 : 404, "storage_not_found");
      if (identityKey(source.hostid) !== key || !source.classification.validUntil || Date.parse(source.classification.validUntil) <= Date.now()) throw new BffError(409, "storage_identity_unverified");
      if (input.filesystemKeys?.some(key => !source!.volumes.some(volume => volume.key === key)) || input.networkInterfaceKey && !source.interfaces.some(item => item.key === input.networkInterfaceKey)) throw new BffError(409, "storage_selection_unverified");
    }
    const { expectedRevision, ...preferences } = input;
    void expectedRevision;
    const data = { ...preferences, filesystemKeys: input.filesystemKeys ?? Prisma.DbNull };
    if (current) {
      const updated = await tx.storageConfig.updateMany({ where: { storageKey: key, revision: input.expectedRevision }, data: { ...data, revision: { increment: 1 } } });
      if (updated.count !== 1) throw new BffError(409, "revision_conflict");
      return result((await tx.storageConfig.findUniqueOrThrow({ where: { storageKey: key } })));
    }
    if (!source) throw new BffError(409, "storage_identity_unverified");
    return result(await tx.storageConfig.create({ data: { ...data, storageKey: key, zabbixHostId: source.hostid, originalName: source.technicalName } }));
  }));
}
