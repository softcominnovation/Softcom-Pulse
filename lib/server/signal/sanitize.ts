import "server-only";

const depStatuses = new Set(["up", "down", "unavailable"]);
const workerStatuses = new Set(["up", "stale", "missing", "unavailable"]);

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}
function dep(value: unknown): "up" | "down" | "unavailable" | { status: "up" | "down" | "unavailable" } | null {
  if (typeof value === "string" && depStatuses.has(value)) return value as "up" | "down" | "unavailable";
  const row = asRecord(value);
  if (!row || typeof row.status !== "string" || !depStatuses.has(row.status)) return null;
  return { status: row.status as "up" | "down" | "unavailable" };
}
function num(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}
function worker(value: unknown) {
  const row = asRecord(value);
  if (!row || typeof row.status !== "string" || !workerStatuses.has(row.status)) return null;
  return {
    status: row.status as string,
    lastHeartbeatAt: typeof row.lastHeartbeatAt === "string" ? row.lastHeartbeatAt : null,
    ageSeconds: num(row.ageSeconds),
    activeInstances: num(row.activeInstances),
  };
}
function pipeline(value: unknown) {
  if (value === "unknown" || value === "unavailable") return value;
  const row = asRecord(value);
  if (!row) return null;
  return {
    outbox_pending: num(row.outbox_pending),
    outbox_dead: num(row.outbox_dead),
    inbox_pending: num(row.inbox_pending),
    inbox_dead: num(row.inbox_dead),
    oldest_outbox_seconds: num(row.oldest_outbox_seconds),
    oldest_inbox_seconds: num(row.oldest_inbox_seconds),
  };
}
function knowledge(value: unknown) {
  if (value === "unavailable") return value;
  const row = asRecord(value);
  if (!row) return null;
  const keys = [
    "itemsPending", "itemsIndexing", "itemsFailed", "jobsQueued", "jobsRunning", "jobsRetryScheduled",
    "jobsFailedCurrent", "expiredLeases", "itemsWithoutActiveJob", "oldestQueuedSeconds",
  ] as const;
  return Object.fromEntries(keys.map(key => [key, num(row[key])]));
}

/** Keep only known readiness check keys; drop headers/tokens/raw bodies. */
export function sanitizeSignalChecks(value: unknown) {
  const row = asRecord(value);
  if (!row) return null;
  const checks: Record<string, unknown> = {};
  if (row.database !== undefined) checks.database = dep(row.database);
  if (row.redis !== undefined) checks.redis = dep(row.redis);
  if (row.objectStorage !== undefined) checks.objectStorage = dep(row.objectStorage);
  if (row.workdeskAudio !== undefined) checks.workdeskAudio = dep(row.workdeskAudio);
  if (row.worker !== undefined) checks.worker = worker(row.worker);
  if (row.pipeline !== undefined) checks.pipeline = pipeline(row.pipeline);
  if (row.knowledgeIndex !== undefined) checks.knowledgeIndex = knowledge(row.knowledgeIndex);
  return Object.keys(checks).length ? checks : null;
}

export function pipelineNumbers(checks: Record<string, unknown> | null) {
  const pipe = checks?.pipeline;
  if (!pipe || typeof pipe !== "object" || Array.isArray(pipe)) {
    return { outboxPending: null, inboxPending: null, outboxDead: null, inboxDead: null, oldestOutboxSeconds: null, oldestInboxSeconds: null };
  }
  const row = pipe as Record<string, unknown>;
  return {
    outboxPending: num(row.outbox_pending),
    inboxPending: num(row.inbox_pending),
    outboxDead: num(row.outbox_dead),
    inboxDead: num(row.inbox_dead),
    oldestOutboxSeconds: num(row.oldest_outbox_seconds),
    oldestInboxSeconds: num(row.oldest_inbox_seconds),
  };
}
