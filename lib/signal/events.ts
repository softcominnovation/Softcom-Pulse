import { signalInboxAgeLimitSeconds, signalOutboxAgeLimitSeconds } from "../config/signal-targets.ts";

export type SignalAttentionEvent = { id: string; tone: "warn" | "bad"; text: string };

type Sample = {
  state: number;
  readyStatus: string | null;
  workerStatus: string | null;
  outboxPending: number | null;
  inboxPending: number | null;
  outboxDead: number | null;
  inboxDead: number | null;
  oldestOutboxSeconds: number | null;
  oldestInboxSeconds: number | null;
  checks: Record<string, unknown> | null;
};

function depDown(value: unknown) {
  if (value === "down" || value === "unavailable") return true;
  if (value && typeof value === "object" && "status" in value) {
    const status = (value as { status?: string }).status;
    return status === "down" || status === "unavailable";
  }
  return false;
}

/** Honest attention events from the latest Signal sample — no invented throughput. */
export function signalAttentionEvents(sample: Sample | null | undefined): SignalAttentionEvent[] {
  if (!sample) return [];
  const events: SignalAttentionEvent[] = [];
  const checks = sample.checks;
  if (sample.readyStatus === "degraded" || sample.state === 2) {
    events.push({ id: "ready-degraded", tone: "bad", text: "API Signal em estado degradado" });
  }
  if (sample.state === 3) {
    events.push({ id: "unreachable", tone: "bad", text: "Live/ready sem resposta útil" });
  }
  if (sample.workerStatus === "stale" || sample.workerStatus === "missing" || sample.workerStatus === "unavailable") {
    events.push({ id: "worker", tone: "bad", text: `Worker lógico ${sample.workerStatus}` });
  }
  if ((sample.oldestOutboxSeconds ?? 0) >= signalOutboxAgeLimitSeconds) {
    events.push({ id: "outbox-age", tone: "warn", text: `Fila outbox acima de ${signalOutboxAgeLimitSeconds}s` });
  }
  if ((sample.oldestInboxSeconds ?? 0) >= signalInboxAgeLimitSeconds) {
    events.push({ id: "inbox-age", tone: "warn", text: `Fila inbox acima de ${signalInboxAgeLimitSeconds}s` });
  }
  if ((sample.outboxDead ?? 0) > 0 || (sample.inboxDead ?? 0) > 0) {
    events.push({ id: "dlq", tone: "warn", text: "Dead letter com mensagens" });
  }
  if (checks) {
    for (const [key, label] of [["database", "Banco"], ["redis", "Redis"], ["objectStorage", "Object storage"], ["workdeskAudio", "Workdesk áudio"]] as const) {
      if (depDown(checks[key])) events.push({ id: `dep-${key}`, tone: "bad", text: `${label} indisponível` });
    }
    const knowledge = checks.knowledgeIndex;
    if (knowledge && typeof knowledge === "object" && !Array.isArray(knowledge)) {
      const row = knowledge as Record<string, unknown>;
      if ([row.itemsFailed, row.jobsFailedCurrent, row.expiredLeases, row.itemsWithoutActiveJob].some(n => typeof n === "number" && n > 0)) {
        events.push({ id: "knowledge", tone: "warn", text: "Índice de conhecimento com falhas" });
      }
    }
  }
  return events;
}
