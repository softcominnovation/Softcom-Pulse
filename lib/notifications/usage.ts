import type { CardMetric } from "../config/agent-monitoring.ts";

export type UsageSample = { metric: CardMetric; limit: number; token: string; sampleAt: number; validUntil: number; value: number | null; rule: string };
export type UsageCheckpoint = { rule: string; active: boolean; lastToken: string; validUntil: number; candidate: { high: boolean; since: number; count: number } | null };
export const recoveryLimit = (limit: number) => limit - Math.min(5, limit / 2);
export function evaluateUsage(previous: UsageCheckpoint | undefined, sample: UsageSample, now: number) {
  const next: UsageCheckpoint = previous?.rule === sample.rule ? structuredClone(previous) : { rule: sample.rule, active: false, lastToken: "", validUntil: 0, candidate: null };
  if (sample.value === null || !Number.isFinite(sample.value) || sample.value < 0 || sample.sampleAt > now || sample.validUntil <= now) {
    next.candidate = null;
    return { checkpoint: next, state: "unknown" as const };
  }
  if (next.validUntil < sample.sampleAt) next.candidate = null;
  next.validUntil = sample.validUntil;
  if (sample.token !== next.lastToken) {
    next.lastToken = sample.token;
    const high = sample.value >= sample.limit;
    const low = sample.value < recoveryLimit(sample.limit);
    if ((!next.active && high) || (next.active && low)) {
      next.candidate = next.candidate?.high === high ? { ...next.candidate, count: next.candidate.count + 1 } : { high, since: sample.sampleAt, count: 1 };
      if (next.candidate.count >= 2 && sample.sampleAt - next.candidate.since >= (sample.metric === "disk" ? 30000 : 60000)) { next.active = high; next.candidate = null; }
    } else next.candidate = null;
  }
  return { checkpoint: next, state: next.active ? "unavailable" as const : next.candidate ? "unknown" as const : "healthy" as const };
}
