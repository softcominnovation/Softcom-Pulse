import "server-only";
import { Prisma } from "../../../generated/prisma/client.ts";
import { ZodError } from "zod";
import {
  monitorState, standaloneVpsLimit, standaloneVpsPatchSchema, standaloneVpsWriteSchema, vpsHistoryRangeSchema, vpsSampleRetentionMs, vpsStackLimit, vpsStackPatchSchema, vpsStackWriteSchema, vpsStripLength,
  type StandaloneVpsInput, type VpsStackInput,
} from "../../config/standalone-vps.ts";
import { BffError } from "../bff.ts";
import { getPrisma } from "../prisma.ts";
import { deleteVpsResult, readVpsResult } from "./store.ts";
import { openVpsMonitorKey, sealVpsMonitorKey } from "./secret.ts";

type VpsRow = {
  id: string; name: string; provider: string | null; ip: string; domain: string | null; managerUrl: string | null; baseUrl: string | null; apiKeyCiphertext: string | null;
  enabled: boolean; monitorPaused: boolean; progressStartedAt: Date | null; dashboardEnabled: boolean; timeoutMs: number; revision: number; createdAt: Date; updatedAt: Date;
};
type SampleRow = { reason: number; latencyMs: number | null; cpuPercent: Prisma.Decimal | null; memoryPercent: Prisma.Decimal | null; diskPercent: Prisma.Decimal | null; checkedAt: Date };
const windows = { "24h": 24, "7d": 24 * 7, "30d": 24 * 30 };
const lockWrites = (tx: Prisma.TransactionClient) => tx.$executeRaw`SELECT pg_advisory_xact_lock(734021010::bigint)`;

async function database<T>(action: () => Promise<T>) {
  try { return await action(); }
  catch (error) { if (error instanceof BffError || error instanceof ZodError) throw error; throw new BffError(503, "database_unavailable"); }
}
function percent(value: Prisma.Decimal | number | null) {
  return value === null ? null : Number(value);
}
function publicVps(row: VpsRow, sample: SampleRow | null, strip: number[]) {
  const monitorConfigured = row.baseUrl !== null;
  const visible = row.enabled && monitorConfigured && !row.monitorPaused;
  return {
    id: row.id, name: row.name, provider: row.provider, ip: row.ip, domain: row.domain, managerUrl: row.managerUrl, baseUrl: row.baseUrl, monitorConfigured,
    enabled: row.enabled, monitorPaused: row.monitorPaused, progressStartedAt: row.progressStartedAt?.toISOString() ?? null, dashboardEnabled: row.dashboardEnabled, timeoutMs: row.timeoutMs, revision: row.revision,
    monitorState: monitorState(row.enabled, monitorConfigured, sample?.reason ?? null, row.monitorPaused),
    reason: visible ? sample?.reason ?? null : null,
    latencyMs: sample?.latencyMs ?? null, cpuPercent: percent(sample?.cpuPercent ?? null), memoryPercent: percent(sample?.memoryPercent ?? null), diskPercent: percent(sample?.diskPercent ?? null),
    checkedAt: visible ? sample?.checkedAt.toISOString() ?? null : null,
    strip: visible ? strip : [],
    createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString(),
  };
}
async function latestSamples(ids: string[]) {
  if (!ids.length) return new Map<string, SampleRow>();
  const rows = await getPrisma().$queryRaw<(SampleRow & { vpsId: string })[]>`
    SELECT DISTINCT ON (vps_id) vps_id AS "vpsId", reason, latency_ms AS "latencyMs", cpu_percent AS "cpuPercent", memory_percent AS "memoryPercent", disk_percent AS "diskPercent", checked_at AS "checkedAt"
    FROM vps_monitor_sample WHERE vps_id IN (${Prisma.join(ids.map(id => Prisma.sql`${id}::uuid`))})
    ORDER BY vps_id, checked_at DESC`;
  return new Map(rows.map(row => [row.vpsId, row]));
}
async function strips(ids: string[]) {
  if (!ids.length) return new Map<string, number[]>();
  const rows = await getPrisma().$queryRaw<{ vps_id: string; reason: number }[]>`
    SELECT vps_id, reason FROM (
      SELECT s.vps_id, s.reason, s.checked_at, row_number() OVER (PARTITION BY s.vps_id ORDER BY s.checked_at DESC) AS n
      FROM vps_monitor_sample s
      JOIN standalone_vps v ON v.id = s.vps_id
      WHERE s.vps_id IN (${Prisma.join(ids.map(id => Prisma.sql`${id}::uuid`))})
        AND v.monitor_paused = false
        AND (v.progress_started_at IS NULL OR s.checked_at >= v.progress_started_at)
    ) ranked WHERE n <= ${vpsStripLength} ORDER BY vps_id, checked_at ASC`;
  const map = new Map<string, number[]>();
  for (const row of rows) {
    const strip = map.get(row.vps_id) ?? [];
    strip.push(Number(row.reason));
    map.set(row.vps_id, strip);
  }
  return map;
}
async function cards(rows: VpsRow[]) {
  const monitored = rows.filter(row => row.enabled && row.baseUrl).map(row => row.id);
  const [samples, presence] = await Promise.all([latestSamples(monitored), strips(monitored)]);
  return rows.map(row => publicVps(row, samples.get(row.id) ?? null, presence.get(row.id) ?? []));
}
async function adminCards(rows: VpsRow[]) {
  const items = await cards(rows);
  return items.map((item, index) => ({ ...item, apiKey: rows[index].apiKeyCiphertext ? openVpsMonitorKey(rows[index].apiKeyCiphertext) : null }));
}
function monitorPair(baseUrl: string | null, hasKey: boolean) {
  if ((baseUrl !== null) !== hasKey) throw new BffError(422, "monitor_incomplete");
}
function nextKey(current: string | null, apiKey: string | null | undefined, baseUrl: string | null) {
  if (baseUrl === null) return null;
  if (apiKey === undefined) return current;
  if (apiKey === null || apiKey.trim() === "") return null;
  if (/[\u0000-\u001F\u007F]/.test(apiKey)) throw new ZodError([{ code: "custom", path: ["apiKey"], message: "Valor inválido." }]);
  return sealVpsMonitorKey(apiKey);
}

export function listStandaloneVps() {
  return database(async () => adminCards(await getPrisma().standaloneVps.findMany({ orderBy: [{ name: "asc" }, { id: "asc" }] }) as VpsRow[]));
}
function highlightCard(item: Awaited<ReturnType<typeof cards>>[number]) {
  return {
    id: item.id, name: item.name, provider: item.provider, ip: item.ip,
    enabled: item.enabled, monitorConfigured: item.monitorConfigured, monitorPaused: item.monitorPaused, monitorState: item.monitorState,
    cpuPercent: item.cpuPercent, memoryPercent: item.memoryPercent, diskPercent: item.diskPercent,
    checkedAt: item.checkedAt, strip: item.strip,
  };
}
export function listHighlightedStandaloneVps() {
  return database(async () => (await cards(await getPrisma().standaloneVps.findMany({ where: { dashboardEnabled: true }, orderBy: [{ name: "asc" }, { id: "asc" }] }) as VpsRow[])).map(highlightCard));
}
export function listEnabledMonitoredVps() {
  return database(async () => getPrisma().standaloneVps.findMany({
    where: { enabled: true, monitorPaused: false, baseUrl: { not: null }, apiKeyCiphertext: { not: null } },
    orderBy: [{ name: "asc" }, { id: "asc" }],
    select: { id: true, baseUrl: true, apiKeyCiphertext: true, timeoutMs: true },
  }));
}
export async function createStandaloneVps(body: unknown) {
  const input = standaloneVpsWriteSchema.parse(body);
  monitorPair(input.baseUrl ?? null, input.apiKey !== undefined);
  return database(() => getPrisma().$transaction(async tx => {
    await lockWrites(tx);
    if (await tx.standaloneVps.count() >= standaloneVpsLimit) throw new BffError(409, "standalone_vps_limit");
    const row = await tx.standaloneVps.create({ data: dataFor(input, input.apiKey ? sealVpsMonitorKey(input.apiKey) : null) });
    return row;
  })).then(row => adminCards([row as VpsRow]).then(items => items[0]));
}
export async function updateStandaloneVps(id: string, body: unknown) {
  const patch = standaloneVpsPatchSchema.parse(body);
  return database(() => getPrisma().$transaction(async tx => {
    await lockWrites(tx);
    const current = await tx.standaloneVps.findUnique({ where: { id } });
    if (!current) throw new BffError(404, "standalone_vps_not_found");
    if (current.revision !== patch.expectedRevision) throw new BffError(409, "revision_conflict");
    const { expectedRevision, apiKey, ...changes } = patch;
    void expectedRevision;
    const baseUrl = changes.baseUrl !== undefined ? changes.baseUrl : current.baseUrl;
    const ciphertext = nextKey(current.apiKeyCiphertext, apiKey, baseUrl);
    monitorPair(baseUrl, ciphertext !== null);
    const resumed = patch.monitorPaused === false && current.monitorPaused;
    return tx.standaloneVps.update({ where: { id }, data: { ...changes, baseUrl, apiKeyCiphertext: ciphertext, revision: { increment: 1 }, ...(resumed ? { progressStartedAt: new Date() } : {}) } });
  })).then(row => adminCards([row as VpsRow]).then(items => items[0]));
}
export function deleteStandaloneVps(id: string) {
  return database(() => getPrisma().$transaction(async tx => {
    await lockWrites(tx);
    const deleted = await tx.standaloneVps.deleteMany({ where: { id } });
    if (!deleted.count) throw new BffError(404, "standalone_vps_not_found");
  })).then(() => deleteVpsResult(id));
}
export async function readStandaloneVps(id: string, options: { range?: string; samples?: boolean } | string = {}) {
  const parsed = typeof options === "string" ? { range: options, samples: false } : options;
  const window = vpsHistoryRangeSchema.parse(parsed.range ?? "24h");
  const includeSamples = parsed.samples === true;
  return database(async () => {
    const row = await getPrisma().standaloneVps.findUnique({ where: { id }, include: { stacks: { orderBy: [{ name: "asc" }, { id: "asc" }] } } });
    if (!row) throw new BffError(404, "standalone_vps_not_found");
    const [card] = await adminCards([row as VpsRow]);
    const samples = includeSamples
      ? await getPrisma().vpsMonitorSample.findMany({ where: { vpsId: id, checkedAt: { gte: new Date(Date.now() - windows[window] * 60 * 60 * 1000) } }, orderBy: { checkedAt: "asc" } })
      : [];
    const result = row.enabled && row.baseUrl ? await readVpsResult(id).catch(() => null) : null;
    return {
      ...card,
      stacks: row.stacks.map(stack => ({ id: stack.id, vpsId: stack.vpsId, name: stack.name, link: stack.link, notes: stack.notes, createdAt: stack.createdAt.toISOString(), updatedAt: stack.updatedAt.toISOString() })),
      result,
      samples: samples.map(sample => ({ checkedAt: sample.checkedAt.toISOString(), reason: sample.reason, latencyMs: sample.latencyMs, cpuPercent: percent(sample.cpuPercent), memoryPercent: percent(sample.memoryPercent), diskPercent: percent(sample.diskPercent) })),
      range: window,
    };
  });
}
export async function createVpsStack(vpsId: string, body: unknown) {
  const input = vpsStackWriteSchema.parse(body);
  return database(() => getPrisma().$transaction(async tx => {
    await lockWrites(tx);
    const vps = await tx.standaloneVps.findUnique({ where: { id: vpsId }, select: { id: true } });
    if (!vps) throw new BffError(404, "standalone_vps_not_found");
    if (await tx.vpsStack.count({ where: { vpsId } }) >= vpsStackLimit) throw new BffError(409, "vps_stack_limit");
    return tx.vpsStack.create({ data: { vpsId, ...input } });
  })).then(publicStack);
}
export async function updateVpsStack(vpsId: string, stackId: string, body: unknown) {
  const patch = vpsStackPatchSchema.parse(body);
  return database(() => getPrisma().$transaction(async tx => {
    await lockWrites(tx);
    const current = await tx.vpsStack.findFirst({ where: { id: stackId, vpsId } });
    if (!current) throw new BffError(404, "vps_stack_not_found");
    return tx.vpsStack.update({ where: { id: stackId }, data: patch });
  })).then(publicStack);
}
export function deleteVpsStack(vpsId: string, stackId: string) {
  return database(() => getPrisma().$transaction(async tx => {
    await lockWrites(tx);
    const deleted = await tx.vpsStack.deleteMany({ where: { id: stackId, vpsId } });
    if (!deleted.count) throw new BffError(404, "vps_stack_not_found");
  }));
}
function publicStack(stack: { id: string; vpsId: string; name: string; link: string | null; notes: string | null; createdAt: Date; updatedAt: Date }) {
  return { id: stack.id, vpsId: stack.vpsId, name: stack.name, link: stack.link, notes: stack.notes, createdAt: stack.createdAt.toISOString(), updatedAt: stack.updatedAt.toISOString() };
}
function dataFor(input: StandaloneVpsInput, apiKeyCiphertext: string | null): Prisma.StandaloneVpsCreateInput {
  const { apiKey, ...data } = input;
  void apiKey;
  return { ...data, apiKeyCiphertext };
}
export async function recordVpsSample(vpsId: string, checkedAt: Date, reason: number, latencyMs: number | null, cpuPercent: number | null, memoryPercent: number | null, diskPercent: number | null) {
  return database(() => getPrisma().vpsMonitorSample.create({ data: { vpsId, checkedAt, reason, latencyMs, cpuPercent, memoryPercent, diskPercent } }));
}
export async function purgeVpsSamples(signal: AbortSignal) {
  const cutoff = new Date(Date.now() - vpsSampleRetentionMs);
  while (!signal.aborted) {
    const removed = await getPrisma().$executeRaw`DELETE FROM vps_monitor_sample WHERE id IN (SELECT id FROM vps_monitor_sample WHERE checked_at < ${cutoff} LIMIT 5000)`;
    if (Number(removed) < 5000) return;
  }
}
export type { VpsStackInput };
