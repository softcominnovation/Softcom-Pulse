import "server-only";
import { Prisma } from "../../../generated/prisma/client.ts";
import { ZodError } from "zod";
import { z } from "zod";
import {
  signalApiBaseUrl, signalHistoryRangeSchema, signalInfraLinkLimit, signalLinkBodySchema,
  signalSampleRetentionMs, signalStates, signalStripLength, signalTargetLimit, signalTargetPatchSchema,
  signalTargetWriteSchema, signalUnlinkBodySchema,
} from "../../config/signal-targets.ts";
import { hostSchema } from "../../monitoring/contracts.ts";
import { BffError } from "../bff.ts";
import { readResult, readSnapshotBatch, snapshotData, snapshotKeys } from "../cache/snapshots.ts";
import { getPrisma } from "../prisma.ts";
import type { SignalClassification } from "./classify.ts";
import { deleteSignalResult, publishSignalResult, readSignalResults } from "./store.ts";

type TargetRow = {
  id: string; displayName: string; description: string | null; baseUrl: string; enabled: boolean;
  dashboardEnabled: boolean; critical: boolean; displayOrder: number; timeoutMs: number; revision: number;
  createdAt: Date; updatedAt: Date;
};
type LinkRow = {
  id: string; targetId: string; role: string; label: string | null; hostKey: string;
  vmKey: string | null; parentHostKey: string | null; createdAt: Date; updatedAt: Date;
};
type SampleRow = {
  state: number; latencyMs: number | null; httpStatus: number | null; liveOk: boolean | null;
  readyStatus: string | null; workerStatus: string | null; activeInstances: number | null;
  outboxPending: number | null; inboxPending: number | null; outboxDead: number | null; inboxDead: number | null;
  oldestOutboxSeconds: number | null; oldestInboxSeconds: number | null; checksJson: Prisma.JsonValue | null; checkedAt: Date;
};

const windows = { "24h": 24, "7d": 24 * 7, "30d": 24 * 30 };
const lockWrites = (tx: Prisma.TransactionClient) => tx.$executeRaw`SELECT pg_advisory_xact_lock(734021012::bigint)`;

async function database<T>(action: () => Promise<T>) {
  try { return await action(); }
  catch (error) { if (error instanceof BffError || error instanceof ZodError) throw error; throw new BffError(503, "database_unavailable"); }
}

async function latestSamples(ids: string[]) {
  if (!ids.length) return new Map<string, SampleRow>();
  const rows = await getPrisma().$queryRaw<(SampleRow & { targetId: string })[]>`
    SELECT DISTINCT ON (target_id) target_id AS "targetId", state, latency_ms AS "latencyMs", http_status AS "httpStatus",
      live_ok AS "liveOk", ready_status AS "readyStatus", worker_status AS "workerStatus", active_instances AS "activeInstances",
      outbox_pending AS "outboxPending", inbox_pending AS "inboxPending", outbox_dead AS "outboxDead", inbox_dead AS "inboxDead",
      oldest_outbox_seconds AS "oldestOutboxSeconds", oldest_inbox_seconds AS "oldestInboxSeconds", checks_json AS "checksJson",
      checked_at AS "checkedAt"
    FROM signal_monitor_sample WHERE target_id IN (${Prisma.join(ids.map(id => Prisma.sql`${id}::uuid`))})
    ORDER BY target_id, checked_at DESC`;
  return new Map(rows.map(row => [row.targetId, row]));
}

async function strips(ids: string[]) {
  if (!ids.length) return new Map<string, number[]>();
  const rows = await getPrisma().$queryRaw<{ target_id: string; state: number }[]>`
    SELECT target_id, state FROM (
      SELECT s.target_id, s.state, s.checked_at, row_number() OVER (PARTITION BY s.target_id ORDER BY s.checked_at DESC) AS n
      FROM signal_monitor_sample s
      WHERE s.target_id IN (${Prisma.join(ids.map(id => Prisma.sql`${id}::uuid`))})
    ) ranked WHERE n <= ${signalStripLength} ORDER BY target_id, checked_at ASC`;
  const map = new Map<string, number[]>();
  for (const row of rows) {
    const strip = map.get(row.target_id) ?? [];
    strip.push(Number(row.state));
    map.set(row.target_id, strip);
  }
  return map;
}

async function uptimeWindow(ids: string[], hours: number) {
  if (!ids.length) return new Map<string, { available: number; total: number }>();
  const since = new Date(Date.now() - hours * 60 * 60 * 1000);
  const rows = await getPrisma().$queryRaw<{ target_id: string; available: number; total: number }[]>`
    SELECT target_id,
      COUNT(*) FILTER (WHERE state IN (${signalStates.ok}, ${signalStates.attention}))::int AS available,
      COUNT(*)::int AS total
    FROM signal_monitor_sample
    WHERE target_id IN (${Prisma.join(ids.map(id => Prisma.sql`${id}::uuid`))}) AND checked_at >= ${since}
    GROUP BY target_id`;
  return new Map(rows.map(row => [row.target_id, { available: Number(row.available), total: Number(row.total) }]));
}

type LinkInventory = {
  status: "ready" | "missing" | "stale";
  name: string | null;
  availability: string | null;
  cpuUsagePercent: number | null;
  memoryUsagePercent: number | null;
};

async function resolveInventory(links: LinkRow[]) {
  const empty = new Map<string, LinkInventory>();
  if (!links.length) return empty;
  const batch = await readSnapshotBatch([snapshotKeys.hosts]).catch(() => null);
  const hosts = batch ? snapshotData(batch, snapshotKeys.hosts, z.array(hostSchema), []) : [];
  const inventory = batch ? readResult(hosts, batch, [snapshotKeys.hosts]) : null;
  const stale = inventory?.stale ?? true;
  const map = new Map<string, LinkInventory>();
  for (const link of links) {
    const host = hosts.find(row => row.hostKey === link.hostKey);
    if (!host) {
      map.set(link.id, { status: "missing", name: null, availability: null, cpuUsagePercent: null, memoryUsagePercent: null });
      continue;
    }
    if (link.vmKey) {
      const vm = host.vms.find(row => row.vmKey === link.vmKey);
      if (!vm) {
        map.set(link.id, { status: "missing", name: null, availability: null, cpuUsagePercent: null, memoryUsagePercent: null });
        continue;
      }
      map.set(link.id, {
        status: stale ? "stale" : "ready",
        name: vm.displayName ?? vm.name,
        availability: vm.state,
        cpuUsagePercent: vm.metrics.cpuUsagePercent?.value ?? null,
        memoryUsagePercent: vm.metrics.memoryUsagePercent?.value ?? null,
      });
    } else {
      map.set(link.id, {
        status: stale ? "stale" : "ready",
        name: host.displayName ?? host.name,
        availability: host.availability,
        cpuUsagePercent: host.metrics.cpuUsagePercent?.value ?? null,
        memoryUsagePercent: host.metrics.memoryUsagePercent?.value ?? null,
      });
    }
  }
  return map;
}

function publicLink(link: LinkRow, inventory: LinkInventory) {
  return {
    id: link.id, role: link.role, label: link.label, hostKey: link.hostKey, vmKey: link.vmKey,
    parentHostKey: link.parentHostKey, inventoryStatus: inventory.status,
    inventoryName: inventory.name, inventoryAvailability: inventory.availability,
    cpuUsagePercent: inventory.cpuUsagePercent, memoryUsagePercent: inventory.memoryUsagePercent,
    createdAt: link.createdAt.toISOString(), updatedAt: link.updatedAt.toISOString(),
  };
}

function publicTarget(
  row: TargetRow,
  sample: SampleRow | null,
  strip: number[],
  uptime24h: { available: number; total: number } | null,
  uptime7d: { available: number; total: number } | null,
  uptime30d: { available: number; total: number } | null,
  links: ReturnType<typeof publicLink>[],
  redis: Awaited<ReturnType<typeof readSignalResults>> extends Map<string, infer V> ? V : never,
) {
  const recent = row.enabled ? (redis ?? (sample ? {
    state: sample.state, latencyMs: sample.latencyMs, httpStatus: sample.httpStatus, liveOk: sample.liveOk,
    readyStatus: sample.readyStatus as "ok" | "degraded" | "unknown" | null, workerStatus: sample.workerStatus,
    activeInstances: sample.activeInstances, outboxPending: sample.outboxPending, inboxPending: sample.inboxPending,
    outboxDead: sample.outboxDead, inboxDead: sample.inboxDead, oldestOutboxSeconds: sample.oldestOutboxSeconds,
    oldestInboxSeconds: sample.oldestInboxSeconds, checks: sample.checksJson as Record<string, unknown> | null,
    strip, uptime24h, checkedAt: sample.checkedAt.toISOString(),
  } : null)) : null;
  const state = !row.enabled ? signalStates.no_data : recent?.state ?? signalStates.no_data;
  return {
    id: row.id, displayName: row.displayName, description: row.description, baseUrl: row.baseUrl,
    enabled: row.enabled, dashboardEnabled: row.dashboardEnabled, critical: row.critical,
    displayOrder: row.displayOrder, timeoutMs: row.timeoutMs, revision: row.revision,
    state, latencyMs: recent?.latencyMs ?? null, httpStatus: recent?.httpStatus ?? null,
    liveOk: recent?.liveOk ?? null, readyStatus: recent?.readyStatus ?? null, workerStatus: recent?.workerStatus ?? null,
    activeInstances: recent?.activeInstances ?? null,
    outboxPending: recent?.outboxPending ?? null, inboxPending: recent?.inboxPending ?? null,
    outboxDead: recent?.outboxDead ?? null, inboxDead: recent?.inboxDead ?? null,
    oldestOutboxSeconds: recent?.oldestOutboxSeconds ?? null, oldestInboxSeconds: recent?.oldestInboxSeconds ?? null,
    checks: recent?.checks ?? null, strip: recent?.strip ?? (!row.enabled ? [] : strip),
    uptime24h: recent?.uptime24h ?? uptime24h, uptime7d, uptime30d,
    checkedAt: recent && "checkedAt" in recent ? recent.checkedAt : sample?.checkedAt.toISOString() ?? null,
    links,
    createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString(),
  };
}

async function assemble(rows: TargetRow[]) {
  const ids = rows.map(row => row.id);
  const [samples, presence, day, week, month, redis, allLinks] = await Promise.all([
    latestSamples(ids),
    strips(ids),
    uptimeWindow(ids, 24),
    uptimeWindow(ids, 24 * 7),
    uptimeWindow(ids, 24 * 30),
    readSignalResults(ids).catch(() => new Map()),
    database(() => getPrisma().signalInfraLink.findMany({ where: { targetId: { in: ids } }, orderBy: [{ role: "asc" }, { hostKey: "asc" }] }) as Promise<LinkRow[]>),
  ]);
  const inventory = await resolveInventory(allLinks);
  const byTarget = new Map<string, LinkRow[]>();
  for (const link of allLinks) {
    const list = byTarget.get(link.targetId) ?? [];
    list.push(link);
    byTarget.set(link.targetId, list);
  }
  const missing: LinkInventory = { status: "missing", name: null, availability: null, cpuUsagePercent: null, memoryUsagePercent: null };
  return rows.map(row => publicTarget(
    row,
    samples.get(row.id) ?? null,
    presence.get(row.id) ?? [],
    day.get(row.id) ?? null,
    week.get(row.id) ?? null,
    month.get(row.id) ?? null,
    (byTarget.get(row.id) ?? []).map(link => publicLink(link, inventory.get(link.id) ?? missing)),
    redis.get(row.id) ?? null,
  ));
}

export function listEnabledSignalTargets() {
  return database(async () => getPrisma().signalTarget.findMany({
    where: { enabled: true },
    orderBy: [{ displayOrder: "asc" }, { id: "asc" }],
    select: { id: true, baseUrl: true, timeoutMs: true },
  }));
}

/** When SIGNAL_API_BASE_URL is set, ensure a PG target exists for that base URL (stack default). */
export function ensureSignalTargetFromEnv() {
  const baseUrl = signalApiBaseUrl();
  if (baseUrl === undefined) return Promise.resolve(null);
  if (baseUrl === null) throw new BffError(503, "signal_monitor_configuration_invalid");
  return database(async () => getPrisma().$transaction(async tx => {
    await lockWrites(tx);
    const existing = await tx.signalTarget.findFirst({ where: { baseUrl }, select: { id: true, baseUrl: true, timeoutMs: true, enabled: true } });
    if (existing) return existing.enabled ? { id: existing.id, baseUrl: existing.baseUrl, timeoutMs: existing.timeoutMs } : null;
    const total = await tx.signalTarget.count();
    if (total >= signalTargetLimit) return null;
    const row = await tx.signalTarget.create({
      data: {
        displayName: "Softcom Signal",
        description: "Seeded from SIGNAL_API_BASE_URL",
        baseUrl,
        enabled: true,
        dashboardEnabled: false,
      },
      select: { id: true, baseUrl: true, timeoutMs: true },
    });
    return row;
  }));
}

export function listSignalTargets() {
  return database(async () => assemble(await getPrisma().signalTarget.findMany({ orderBy: [{ displayOrder: "asc" }, { id: "asc" }] }) as TargetRow[]));
}

export function listHighlightedSignalTargets() {
  return database(async () => {
    const rows = await getPrisma().signalTarget.findMany({
      where: { dashboardEnabled: true },
      orderBy: [{ displayOrder: "asc" }, { id: "asc" }],
    }) as TargetRow[];
    const items = await assemble(rows);
    return items.map(item => ({
      id: item.id, displayName: item.displayName, description: item.description, critical: item.critical,
      displayOrder: item.displayOrder, enabled: item.enabled, state: item.state, latencyMs: item.latencyMs,
      readyStatus: item.readyStatus, workerStatus: item.workerStatus, activeInstances: item.activeInstances,
      strip: item.strip, uptime24h: item.uptime24h, checkedAt: item.checkedAt,
    }));
  });
}

/** First enabled target for the signal_flow dashboard block (display order). */
export function listSignalFlowTarget() {
  return database(async () => {
    const rows = await getPrisma().signalTarget.findMany({
      where: { enabled: true },
      orderBy: [{ displayOrder: "asc" }, { id: "asc" }],
      take: 1,
    }) as TargetRow[];
    if (!rows.length) return null;
    const [item] = await assemble(rows);
    return {
      id: item.id, displayName: item.displayName, description: item.description, state: item.state,
      latencyMs: item.latencyMs, readyStatus: item.readyStatus, workerStatus: item.workerStatus,
      activeInstances: item.activeInstances, strip: item.strip, checkedAt: item.checkedAt,
      outboxPending: item.outboxPending, inboxPending: item.inboxPending,
      outboxDead: item.outboxDead, inboxDead: item.inboxDead,
      oldestOutboxSeconds: item.oldestOutboxSeconds, oldestInboxSeconds: item.oldestInboxSeconds,
      checks: item.checks,
    };
  });
}

export function getSignalTarget(id: string) {
  return database(async () => {
    const row = await getPrisma().signalTarget.findUnique({ where: { id } }) as TargetRow | null;
    if (!row) throw new BffError(404, "not_found");
    return (await assemble([row]))[0];
  });
}

export function createSignalTarget(body: unknown) {
  const input = signalTargetWriteSchema.parse(body);
  return database(async () => {
    const row = await getPrisma().$transaction(async tx => {
      await lockWrites(tx);
      const total = await tx.signalTarget.count();
      if (total >= signalTargetLimit) throw new BffError(409, "signal_target_limit");
      return tx.signalTarget.create({ data: {
        displayName: input.displayName, description: input.description, baseUrl: input.baseUrl,
        enabled: input.enabled, dashboardEnabled: input.dashboardEnabled, critical: input.critical,
        displayOrder: input.displayOrder, timeoutMs: input.timeoutMs,
      } }) as Promise<TargetRow>;
    });
    return (await assemble([row]))[0];
  });
}

export function updateSignalTarget(id: string, body: unknown) {
  const input = signalTargetPatchSchema.parse(body);
  return database(async () => {
    const row = await getPrisma().$transaction(async tx => {
      await lockWrites(tx);
      const current = await tx.signalTarget.findUnique({ where: { id } });
      if (!current) throw new BffError(404, "not_found");
      if (current.revision !== input.expectedRevision) throw new BffError(409, "revision_conflict");
      const { expectedRevision: _, ...patch } = input;
      void _;
      return tx.signalTarget.update({
        where: { id },
        data: { ...patch, revision: { increment: 1 } },
      }) as Promise<TargetRow>;
    });
    return (await assemble([row]))[0];
  });
}

export function deleteSignalTarget(id: string) {
  return database(async () => {
    await getPrisma().$transaction(async tx => {
      await lockWrites(tx);
      const current = await tx.signalTarget.findUnique({ where: { id } });
      if (!current) throw new BffError(404, "not_found");
      await tx.signalTarget.delete({ where: { id } });
    });
    await deleteSignalResult(id).catch(() => undefined);
  });
}

export function addSignalInfraLink(targetId: string, body: unknown) {
  const input = signalLinkBodySchema.parse(body);
  return database(async () => {
    const row = await getPrisma().$transaction(async tx => {
      await lockWrites(tx);
      const target = await tx.signalTarget.findUnique({ where: { id: targetId } });
      if (!target) throw new BffError(404, "not_found");
      if (target.revision !== input.expectedRevision) throw new BffError(409, "revision_conflict");
      const count = await tx.signalInfraLink.count({ where: { targetId } });
      if (count >= signalInfraLinkLimit) throw new BffError(409, "signal_infra_link_limit");
      const vmKey = input.vmKey ?? "";
      const clash = await tx.$queryRaw<{ id: string }[]>`
        SELECT id FROM signal_infra_link
        WHERE target_id = ${targetId}::uuid AND host_key = ${input.hostKey} AND COALESCE(vm_key, '') = ${vmKey}
        LIMIT 1`;
      if (clash.length) throw new BffError(409, "signal_infra_link_conflict");
      await tx.signalInfraLink.create({
        data: {
          targetId, role: input.role, label: input.label, hostKey: input.hostKey,
          vmKey: input.vmKey, parentHostKey: input.parentHostKey,
        },
      });
      return tx.signalTarget.update({ where: { id: targetId }, data: { revision: { increment: 1 } } }) as Promise<TargetRow>;
    });
    return (await assemble([row]))[0];
  });
}

export function removeSignalInfraLink(targetId: string, linkId: string, body: unknown) {
  const input = signalUnlinkBodySchema.parse(body);
  return database(async () => {
    const row = await getPrisma().$transaction(async tx => {
      await lockWrites(tx);
      const target = await tx.signalTarget.findUnique({ where: { id: targetId } });
      if (!target) throw new BffError(404, "not_found");
      if (target.revision !== input.expectedRevision) throw new BffError(409, "revision_conflict");
      const link = await tx.signalInfraLink.findFirst({ where: { id: linkId, targetId } });
      if (!link) throw new BffError(404, "not_found");
      await tx.signalInfraLink.delete({ where: { id: linkId } });
      return tx.signalTarget.update({ where: { id: targetId }, data: { revision: { increment: 1 } } }) as Promise<TargetRow>;
    });
    return (await assemble([row]))[0];
  });
}

export function recordSignalSample(targetId: string, checkedAt: Date, classification: SignalClassification) {
  return database(async () => {
    await getPrisma().signalMonitorSample.create({
      data: {
        targetId, checkedAt, state: classification.state, latencyMs: classification.latencyMs,
        httpStatus: classification.httpStatus, liveOk: classification.liveOk,
        readyStatus: classification.readyStatus, workerStatus: classification.workerStatus,
        activeInstances: classification.activeInstances, outboxPending: classification.outboxPending,
        inboxPending: classification.inboxPending, outboxDead: classification.outboxDead,
        inboxDead: classification.inboxDead, oldestOutboxSeconds: classification.oldestOutboxSeconds,
        oldestInboxSeconds: classification.oldestInboxSeconds,
        checksJson: classification.checks === null ? Prisma.JsonNull : classification.checks as Prisma.InputJsonValue,
      },
    });
    const presence = await strips([targetId]);
    const uptime = await uptimeWindow([targetId], 24);
    await publishSignalResult(targetId, checkedAt.toISOString(), {
      state: classification.state, latencyMs: classification.latencyMs, httpStatus: classification.httpStatus,
      liveOk: classification.liveOk, readyStatus: classification.readyStatus, workerStatus: classification.workerStatus,
      activeInstances: classification.activeInstances, outboxPending: classification.outboxPending,
      inboxPending: classification.inboxPending, outboxDead: classification.outboxDead, inboxDead: classification.inboxDead,
      oldestOutboxSeconds: classification.oldestOutboxSeconds, oldestInboxSeconds: classification.oldestInboxSeconds,
      checks: classification.checks, strip: presence.get(targetId) ?? [classification.state],
      uptime24h: uptime.get(targetId) ?? { available: classification.state === signalStates.ok || classification.state === signalStates.attention ? 1 : 0, total: 1 },
    }).catch(() => undefined);
  });
}

export function purgeSignalSamples(signal?: AbortSignal) {
  return database(async () => {
    const cutoff = new Date(Date.now() - signalSampleRetentionMs);
    for (;;) {
      if (signal?.aborted) return;
      const deleted = await getPrisma().$executeRaw`
        DELETE FROM signal_monitor_sample WHERE id IN (
          SELECT id FROM signal_monitor_sample WHERE checked_at < ${cutoff} ORDER BY id LIMIT 5000
        )`;
      if (!deleted) break;
    }
  });
}

export function signalTargetHistory(id: string, range: z.infer<typeof signalHistoryRangeSchema>) {
  return database(async () => {
    const target = await getPrisma().signalTarget.findUnique({ where: { id } });
    if (!target) throw new BffError(404, "not_found");
    const since = new Date(Date.now() - windows[range] * 60 * 60 * 1000);
    const rows = await getPrisma().signalMonitorSample.findMany({
      where: { targetId: id, checkedAt: { gte: since } },
      orderBy: { checkedAt: "asc" },
      select: { checkedAt: true, state: true, latencyMs: true, readyStatus: true, workerStatus: true },
    });
    return {
      targetId: id, range,
      points: rows.map(row => ({
        checkedAt: row.checkedAt.toISOString(), state: row.state, latencyMs: row.latencyMs,
        readyStatus: row.readyStatus, workerStatus: row.workerStatus,
      })),
    };
  });
}
