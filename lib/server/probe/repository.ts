import "server-only";
import { Prisma } from "../../../generated/prisma/client.ts";
import { ZodError } from "zod";
import { externalServiceHistoryRangeSchema, externalServicePatchSchema, externalServiceWriteSchema, probeServiceLimit, serviceIssues, serviceNeedsSecret, type ExternalServiceInput } from "../../config/external-services.ts";
import { downsampleProbeHistoryPoints, probeHistoryChartMaxPoints } from "../../probe/history.ts";
import { BffError } from "../bff.ts";
import { getPrisma } from "../prisma.ts";
import { assertProbeDestination, parseProbeUrl } from "./network.ts";
import { sealProbeSecret } from "./secret.ts";
import { cacheOperation } from "../cache.ts";
import { probeResultKey } from "./store.ts";

type Row = {
  id: string; displayName: string; description: string | null; serviceType: string | null; enabled: boolean; dashboardEnabled: boolean; critical: boolean; displayOrder: number; revision: number;
  method: "GET" | "HEAD" | "POST"; url: string; successMode: "http_status" | "json_match"; expectedStatuses: number[]; jsonPointer: string | null; expectedValue: string | null;
  bodyTemplate: string | null; authMode: "none" | "header"; headerName: string | null; timeoutMs: number; progressStartedAt: Date | null; secretCiphertext: string | null; createdAt: Date; updatedAt: Date;
};
const publicService = (row: Row) => {
  const { secretCiphertext, createdAt, updatedAt, progressStartedAt, expectedValue, ...service } = row;
  return { ...service, progressStartedAt: progressStartedAt?.toISOString() ?? null, expectedValue: expectedValue === null ? null : JSON.parse(expectedValue) as string | number | boolean, secretConfigured: secretCiphertext !== null, createdAt: createdAt.toISOString(), updatedAt: updatedAt.toISOString() };
};
async function database<T>(action: () => Promise<T>) {
  try { return await action(); }
  catch (error) { if (error instanceof BffError || error instanceof ZodError) throw error; throw new BffError(503, "database_unavailable"); }
}
function checked(input: ExternalServiceInput, existingSecret: boolean) {
  parseProbeUrl(input.url);
  const issues = serviceIssues(input, existingSecret);
  if (issues.length) throw new ZodError(issues.map(path => ({ code: "custom", path: [path], message: "Valor inválido." })));
  return input;
}
export function listExternalServices() {
  return database(async () => (await getPrisma().externalService.findMany({ orderBy: [{ displayOrder: "asc" }, { displayName: "asc" }, { id: "asc" }] })).map(row => publicService(row as Row)));
}
export function getExternalService(id: string) {
  return database(async () => {
    const row = await getPrisma().externalService.findUnique({ where: { id } });
    if (!row) throw new BffError(404, "external_service_not_found");
    return row as Row;
  });
}
export async function createExternalService(body: unknown) {
  const parsed = externalServiceWriteSchema.parse(body);
  await assertProbeDestination(parsed.url);
  const input = checked(parsed, false);
  return database(() => getPrisma().$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(734021008::bigint)`;
    if (await tx.externalService.count() >= probeServiceLimit) throw new BffError(409, "external_service_limit");
    const row = await tx.externalService.create({ data: dataFor(input, input.secret ? sealProbeSecret(input.secret) : null) });
    return publicService(row as Row);
  }));
}
export async function updateExternalService(id: string, body: unknown) {
  const patch = externalServicePatchSchema.parse(body);
  if (patch.url !== undefined) await assertProbeDestination(patch.url);
  return database(() => getPrisma().$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(734021008::bigint)`;
    const current = await tx.externalService.findUnique({ where: { id } });
    if (!current) throw new BffError(404, "external_service_not_found");
    if (current.revision !== patch.expectedRevision) throw new BffError(409, "revision_conflict");
    const { expectedRevision, secret, ...changes } = patch;
    void expectedRevision;
    const currentRow = current as Row;
    const merged = checked(externalServiceWriteSchema.parse({
      displayName: currentRow.displayName, description: currentRow.description, serviceType: currentRow.serviceType, enabled: currentRow.enabled, dashboardEnabled: currentRow.dashboardEnabled,
      critical: currentRow.critical, displayOrder: currentRow.displayOrder, method: currentRow.method, url: currentRow.url, successMode: currentRow.successMode, expectedStatuses: currentRow.expectedStatuses,
      jsonPointer: currentRow.jsonPointer, expectedValue: currentRow.expectedValue === null ? null : JSON.parse(currentRow.expectedValue), bodyTemplate: currentRow.bodyTemplate, authMode: currentRow.authMode, headerName: currentRow.headerName, timeoutMs: currentRow.timeoutMs,
      ...changes, secret,
    }), currentRow.secretCiphertext !== null && secret === undefined);
    const nextSecret = !serviceNeedsSecret(merged) || secret === null ? null : secret === undefined ? current.secretCiphertext : sealProbeSecret(secret);
    const resumed = merged.enabled && !current.enabled;
    const row = await tx.externalService.update({ where: { id }, data: { ...dataFor(merged, nextSecret), revision: { increment: 1 }, ...(resumed ? { progressStartedAt: new Date() } : {}) } });
    return publicService(row as Row);
  }));
}
export function deleteExternalService(id: string) {
  return database(async () => {
    const deleted = await getPrisma().externalService.deleteMany({ where: { id } });
    if (!deleted.count) throw new BffError(404, "external_service_not_found");
    await cacheOperation(client => client.del(probeResultKey(id))).catch(() => undefined);
  });
}
export function listEnabledExternalServices() {
  return database(async () => (await getPrisma().externalService.findMany({ where: { enabled: true }, orderBy: [{ displayOrder: "asc" }, { displayName: "asc" }, { id: "asc" }] })) as Row[]);
}
function dataFor(input: ExternalServiceInput, secretCiphertext: string | null): Prisma.ExternalServiceCreateInput {
  const { secret, expectedValue, ...data } = input;
  void secret;
  const serialized = expectedValue === null ? null : JSON.stringify(expectedValue);
  if (serialized && serialized.length > 80) throw new ZodError([{ code: "custom", path: ["expectedValue"], message: "Valor inválido." }]);
  return { ...data, expectedValue: serialized, secretCiphertext };
}
const windows = { "24h": 24, "7d": 24 * 7, "30d": 24 * 30 };
export async function externalServiceHistory(id: string, range: string) {
  const window = externalServiceHistoryRangeSchema.parse(range);
  return database(async () => {
    await getExternalService(id);
    const since = new Date(Date.now() - windows[window] * 60 * 60 * 1000);
    const uptime = async (hours: number) => {
      const rows = await getPrisma().$queryRaw<{ available: number; total: number }[]>`SELECT COUNT(*) FILTER (WHERE reason IN (0, 1))::int AS available, COUNT(*)::int AS total FROM external_service_sample WHERE service_id = ${id} AND checked_at >= ${new Date(Date.now() - hours * 60 * 60 * 1000)}`;
      return rows[0] && Number(rows[0].total) ? { available: Number(rows[0].available), total: Number(rows[0].total) } : null;
    };
    const [averageRow] = await getPrisma().$queryRaw<{ average: number | null }[]>`
      SELECT AVG(latency_ms)::float AS average
      FROM external_service_sample
      WHERE service_id = ${id}::uuid AND checked_at >= ${since} AND latency_ms IS NOT NULL`;
    const latest = await getPrisma().externalServiceSample.findFirst({ where: { serviceId: id }, orderBy: { checkedAt: "desc" }, select: { latencyMs: true } });
    const total = await getPrisma().externalServiceSample.count({ where: { serviceId: id, checkedAt: { gte: since } } });
    let points: { checkedAt: string; reason: number; latencyMs: number | null }[];
    if (total <= probeHistoryChartMaxPoints) {
      const rows = await getPrisma().externalServiceSample.findMany({ where: { serviceId: id, checkedAt: { gte: since } }, orderBy: { checkedAt: "asc" }, select: { checkedAt: true, reason: true, latencyMs: true } });
      points = rows.map(point => ({ checkedAt: point.checkedAt.toISOString(), reason: point.reason, latencyMs: point.latencyMs }));
    } else {
      // Dense windows: one sample per time bucket in Postgres, then a hard cap for the chart payload.
      const sampled = await getPrisma().$queryRaw<{ checkedAt: Date; reason: number; latencyMs: number | null }[]>`
        WITH source AS (
          SELECT checked_at AS "checkedAt", reason, latency_ms AS "latencyMs",
            width_bucket(
              extract(epoch FROM checked_at),
              extract(epoch FROM ${since}::timestamptz),
              extract(epoch FROM clock_timestamp()),
              ${probeHistoryChartMaxPoints}::int
            ) AS bucket
          FROM external_service_sample
          WHERE service_id = ${id}::uuid AND checked_at >= ${since}
        ),
        picked AS (
          SELECT DISTINCT ON (bucket) "checkedAt", reason, "latencyMs"
          FROM source
          WHERE bucket >= 1 AND bucket <= ${probeHistoryChartMaxPoints}
          -- Prefer the worst reason in the bucket so short outages are not hidden by a later OK.
          ORDER BY bucket, reason DESC, ("latencyMs" IS NULL) DESC, "checkedAt" DESC
        )
        SELECT "checkedAt", reason, "latencyMs" FROM picked ORDER BY "checkedAt" ASC`;
      points = downsampleProbeHistoryPoints(
        sampled.map(point => ({ checkedAt: point.checkedAt.toISOString(), reason: Number(point.reason), latencyMs: point.latencyMs })),
      );
    }
    return {
      serviceId: id,
      range: window,
      points,
      summary: {
        currentLatencyMs: latest?.latencyMs ?? null,
        averageLatencyMs: averageRow?.average == null ? null : Math.round(averageRow.average),
        uptime24h: await uptime(24),
        uptime7d: await uptime(24 * 7),
        uptime30d: await uptime(24 * 30),
      },
    };
  });
}
export async function visualStrips(ids: string[]) {
  if (!ids.length) return new Map<string, number[]>();
  return database(async () => {
    const samples = await getPrisma().$queryRaw<{ service_id: string; reason: number }[]>`
      SELECT service_id, reason FROM (
        SELECT s.service_id, s.reason, s.checked_at, row_number() OVER (PARTITION BY s.service_id ORDER BY s.checked_at DESC) AS n
        FROM external_service_sample s
        JOIN external_service e ON e.id = s.service_id
        WHERE s.service_id IN (${Prisma.join(ids.map(id => Prisma.sql`${id}::uuid`))})
          AND (e.progress_started_at IS NULL OR s.checked_at >= e.progress_started_at)
      ) ranked
      WHERE n <= 40
      ORDER BY service_id, checked_at ASC
    `;
    const strips = new Map<string, number[]>();
    for (const sample of samples) {
      const strip = strips.get(sample.service_id) ?? [];
      strip.push(Number(sample.reason));
      strips.set(sample.service_id, strip);
    }
    return strips;
  });
}
export async function recordExternalSample(serviceId: string, checkedAt: Date, reason: number, latencyMs: number | null, httpStatus: number | null) {
  return database(async () => {
    await getPrisma().externalServiceSample.create({ data: { serviceId, checkedAt, reason, latencyMs, httpStatus } });
    const [uptime] = await getPrisma().$queryRaw<{ available: number; total: number }[]>`SELECT COUNT(*) FILTER (WHERE reason IN (0, 1))::int AS available, COUNT(*)::int AS total FROM external_service_sample WHERE service_id = ${serviceId} AND checked_at >= ${new Date(checkedAt.getTime() - 24 * 60 * 60 * 1000)}`;
    const started = await getPrisma().externalService.findUnique({ where: { id: serviceId }, select: { progressStartedAt: true } });
    const recent = await getPrisma().externalServiceSample.findMany({ where: { serviceId, ...(started?.progressStartedAt ? { checkedAt: { gte: started.progressStartedAt } } : {}) }, orderBy: { checkedAt: "desc" }, take: 40, select: { reason: true } });
    return { uptime24h: { available: Number(uptime?.available ?? 0), total: Number(uptime?.total ?? 0) }, strip: recent.reverse().map(item => item.reason) };
  });
}
export async function purgeExternalSamples(signal: AbortSignal) {
  const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  while (!signal.aborted) {
    const removed = await getPrisma().$executeRaw`DELETE FROM external_service_sample WHERE id IN (SELECT id FROM external_service_sample WHERE checked_at < ${cutoff} LIMIT 5000)`;
    if (removed < 5000) return;
  }
}
