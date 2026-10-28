import type { NotificationSeverity } from "../../notifications/policy.ts";

export type ConditionState = "healthy" | "attention" | "unavailable" | "unknown" | "suppressed";
type KnownState = Exclude<ConditionState, "unknown" | "suppressed">;
export type ConditionObservation = {
  epoch: string;
  fingerprint: string;
  checkedAt: number;
  observedAt: number;
  validUntil: number;
  state: ConditionState;
  severity: NotificationSeverity;
  sourceSeverity: number | null;
  confirmation: "explicit" | "sampled";
};
export type ConditionIncident = {
  startedAt: number;
  confirmedAt: number;
  severity: NotificationSeverity;
  rank: number;
  highestAnnouncedRank: number | null;
};
export type ConditionCheckpoint = {
  epoch: string;
  checkedAt: number;
  fingerprint: string | null;
  confirmed: KnownState | null;
  candidate: { state: KnownState; count: number; firstObservedAt: number } | null;
  incident: ConditionIncident | null;
  eligible: boolean;
};
export type ConditionTransition = {
  checkpoint: ConditionCheckpoint;
  incidentAction: "opened" | "updated" | "resolved" | "cancelled" | null;
  event: "opened" | "escalated" | "recovered" | null;
  previousIncident: ConditionIncident | null;
  ignored: boolean;
};
export type TransitionOptions = {
  now: number;
  expectedEpoch: string;
  baseline: boolean;
  eligible: boolean;
  recoveryEnabled: boolean;
};

function emptyCheckpoint(epoch: string): ConditionCheckpoint {
  return { epoch, checkedAt: 0, fingerprint: null, confirmed: null, candidate: null, incident: null, eligible: false };
}

/** Pure per-condition reducer. The caller owns the complete family baseline and transactional locks. */
export function evaluateCondition(
  previous: ConditionCheckpoint | null, observation: ConditionObservation, options: TransitionOptions,
): ConditionTransition {
  const checkpoint: ConditionCheckpoint = previous ? structuredClone(previous) : emptyCheckpoint(options.expectedEpoch);
  const result: ConditionTransition = {
    checkpoint, incidentAction: null, event: null, previousIncident: previous?.incident ?? null, ignored: false,
  };
  if (observation.epoch !== options.expectedEpoch || checkpoint.epoch !== options.expectedEpoch
    || !Number.isFinite(options.now) || !Number.isFinite(observation.checkedAt)
    || observation.checkedAt > options.now || observation.checkedAt <= checkpoint.checkedAt) {
    return { ...result, ignored: true };
  }
  checkpoint.checkedAt = observation.checkedAt;
  if (observation.state === "suppressed") {
    checkpoint.incident = null; checkpoint.candidate = null; checkpoint.confirmed = null;
    checkpoint.fingerprint = null; checkpoint.eligible = false;
    result.incidentAction = result.previousIncident ? "cancelled" : null;
    return result;
  }
  const unknown = observation.state === "unknown" || !Number.isFinite(observation.observedAt)
    || !Number.isFinite(observation.validUntil) || observation.observedAt > observation.checkedAt
    || observation.validUntil <= options.now;
  if (unknown) {
    checkpoint.candidate = null;
    return result;
  }
  const state = observation.state as KnownState;
  const policyBecameEligible = previous !== null && !checkpoint.eligible && options.eligible;
  checkpoint.eligible = options.eligible;
  if (observation.fingerprint === checkpoint.fingerprint && !policyBecameEligible && !options.baseline) return result;
  checkpoint.fingerprint = observation.fingerprint;
  const baseline = options.baseline || policyBecameEligible;
  const rank = observation.sourceSeverity ?? ({ info: 0, warning: 2, critical: 4 }[observation.severity]);
  if (!Number.isInteger(rank) || rank < 0 || rank > 5) return { ...result, checkpoint: previous ?? emptyCheckpoint(options.expectedEpoch), ignored: true };

  if (state === checkpoint.confirmed) {
    checkpoint.candidate = null;
    if (!checkpoint.incident && state !== "healthy" && options.eligible) {
      checkpoint.incident = { startedAt: observation.observedAt, confirmedAt: observation.checkedAt, severity: observation.severity, rank, highestAnnouncedRank: null };
      result.incidentAction = "opened";
    }
    if (checkpoint.incident) {
      const incident = checkpoint.incident;
      if (rank !== incident.rank || observation.severity !== incident.severity) {
        result.incidentAction = "updated";
        if (!baseline && options.eligible && rank > incident.rank
          && (incident.highestAnnouncedRank === null || rank > incident.highestAnnouncedRank)) {
          result.event = "escalated"; incident.highestAnnouncedRank = rank;
        }
        incident.rank = rank; incident.severity = observation.severity;
      }
    }
    return result;
  }

  const candidate = checkpoint.candidate?.state === state
    ? { ...checkpoint.candidate, count: checkpoint.candidate.count + 1 }
    : { state, count: 1, firstObservedAt: observation.observedAt };
  const required = baseline || observation.confirmation === "explicit" ? 1 : 2;
  checkpoint.candidate = candidate;
  if (candidate.count < required) return result;
  checkpoint.confirmed = state; checkpoint.candidate = null;
  if (state === "healthy") {
    if (checkpoint.incident) {
      result.incidentAction = "resolved";
      if (!baseline && options.recoveryEnabled && checkpoint.incident.highestAnnouncedRank !== null) result.event = "recovered";
      checkpoint.incident = null;
    }
    return result;
  }
  if (checkpoint.incident) {
    const incident = checkpoint.incident;
    result.incidentAction = "updated";
    if (!baseline && options.eligible && rank > incident.rank
      && (incident.highestAnnouncedRank === null || rank > incident.highestAnnouncedRank)) {
      result.event = "escalated"; incident.highestAnnouncedRank = rank;
    }
    incident.rank = rank; incident.severity = observation.severity;
  } else if (options.eligible) {
    const announce = options.eligible && !baseline;
    checkpoint.incident = {
      startedAt: candidate.firstObservedAt, confirmedAt: observation.checkedAt,
      severity: observation.severity, rank, highestAnnouncedRank: announce ? rank : null,
    };
    result.incidentAction = "opened"; result.event = announce ? "opened" : null;
  }
  return result;
}
