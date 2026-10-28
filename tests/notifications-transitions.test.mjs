import test from "node:test";
import assert from "node:assert/strict";
import { evaluateCondition } from "../lib/server/notifications/transitions.ts";

const origin = 1_800_000_000_000;
function observe(previous, index, state, options = {}, fields = {}) {
  const checkedAt = origin + index * 60000;
  return evaluateCondition(previous, {
    epoch: "one", fingerprint: String(index), checkedAt, observedAt: checkedAt, validUntil: checkedAt + 180000,
    state, severity: state === "attention" ? "warning" : "critical", sourceSeverity: null, confirmation: "sampled", ...fields,
  }, { now: checkedAt, expectedEpoch: "one", baseline: false, eligible: true, recoveryEnabled: true, ...options });
}
const baseline = () => observe(null, 1, "healthy", { baseline: true }).checkpoint;

test("ineligible conditions retain a checkpoint without creating incidents; enabling starts silently", () => {
  const off = observe(null, 1, "unavailable", { eligible: false, baseline: true });
  assert.equal(off.incidentAction, null); assert.equal(off.checkpoint.incident, null);
  const enabled = observe(off.checkpoint, 2, "unavailable");
  assert.equal(enabled.incidentAction, "opened"); assert.equal(enabled.event, null);
  assert.equal(observe(enabled.checkpoint, 3, "healthy", {}, { confirmation: "explicit" }).event, null);
});

test("HTTP failures and recoveries need independent confirmations, with durable replay protection", () => {
  const first = observe(baseline(), 2, "unavailable");
  assert.equal(first.event, null); assert.equal(first.checkpoint.candidate.count, 1);
  const replay = observe(first.checkpoint, 3, "unavailable", {}, { fingerprint: "2" });
  assert.equal(replay.event, null); assert.equal(replay.checkpoint.candidate.count, 1);
  const opened = observe(replay.checkpoint, 4, "unavailable");
  assert.equal(opened.event, "opened"); assert.equal(opened.checkpoint.incident.startedAt, origin + 120000);
  assert.equal(observe(opened.checkpoint, 4, "unavailable").ignored, true);
  const stillDown = observe(opened.checkpoint, 5, "unavailable");
  assert.equal(stillDown.event, null);
  const healthy = observe(stillDown.checkpoint, 6, "healthy");
  assert.equal(healthy.incidentAction, null);
  const recovered = observe(healthy.checkpoint, 7, "healthy");
  assert.equal(recovered.event, "recovered"); assert.equal(recovered.checkpoint.incident, null);
});

test("initial failure is silent but a new condition after the family baseline announces", () => {
  const initial = observe(null, 1, "unavailable", { baseline: true });
  assert.equal(initial.incidentAction, "opened"); assert.equal(initial.event, null);
  assert.equal(observe(initial.checkpoint, 2, "healthy", {}, { confirmation: "explicit" }).event, null);
  const newProblem = observe(null, 2, "unavailable", {}, { confirmation: "explicit", sourceSeverity: 4 });
  assert.equal(newProblem.event, "opened");
});

test("stale and unknown evidence interrupt candidates but never resolve an active incident", () => {
  const candidate = observe(baseline(), 2, "unavailable");
  const gap = observe(candidate.checkpoint, 3, "unknown");
  assert.equal(gap.checkpoint.candidate, null);
  assert.equal(observe(gap.checkpoint, 4, "unavailable").event, null);
  const active = observe(baseline(), 2, "unavailable", {}, { confirmation: "explicit" });
  const stale = observe(active.checkpoint, 3, "healthy", {}, { validUntil: origin });
  assert.equal(stale.incidentAction, null); assert.ok(stale.checkpoint.incident);
  assert.equal(observe(active.checkpoint, 1, "healthy").ignored, true);
});

test("policy off preserves the incident; monitor suppression cancels without recovery", () => {
  const active = observe(baseline(), 2, "unavailable", {}, { confirmation: "explicit" });
  const off = observe(active.checkpoint, 3, "unavailable", { eligible: false, recoveryEnabled: false });
  assert.ok(off.checkpoint.incident); assert.equal(off.incidentAction, null);
  const resumed = observe(off.checkpoint, 4, "unavailable");
  assert.equal(resumed.event, null);
  const cancelled = observe(resumed.checkpoint, 5, "suppressed");
  assert.equal(cancelled.incidentAction, "cancelled"); assert.equal(cancelled.event, null);
  assert.equal(observe(cancelled.checkpoint, 6, "unavailable", { expectedEpoch: "two" }).ignored, true);
});

test("severity escalation uses changed facts, not the opening clock, and cannot repeat a level", () => {
  const active = observe(baseline(), 2, "unavailable", {}, { confirmation: "explicit", sourceSeverity: 4 });
  const higher = observe(active.checkpoint, 3, "unavailable", {}, { observedAt: origin + 120000, sourceSeverity: 5 });
  assert.equal(higher.event, "escalated");
  const lower = observe(higher.checkpoint, 4, "unavailable", {}, { sourceSeverity: 4 });
  assert.equal(lower.event, null);
  const higherAgain = observe(lower.checkpoint, 5, "unavailable", {}, { sourceSeverity: 5 });
  assert.equal(higherAgain.event, null); assert.equal(higherAgain.checkpoint.incident.highestAnnouncedRank, 5);
});

test("invalid future evidence is ignored without mutating the previous checkpoint", () => {
  const checkpoint = baseline(), saved = structuredClone(checkpoint);
  assert.equal(observe(checkpoint, 2, "unavailable", { now: origin }).ignored, true);
  assert.deepEqual(checkpoint, saved);
});

test("re-enabling alerts on a cached failing candidate establishes a silent baseline", () => {
  const candidate = observe(baseline(), 2, "unavailable", { eligible: false, recoveryEnabled: false });
  const enabled = observe(candidate.checkpoint, 3, "unavailable", {}, { fingerprint: "2" });
  assert.equal(enabled.event, null); assert.equal(enabled.incidentAction, "opened");
  assert.equal(enabled.checkpoint.incident.highestAnnouncedRank, null);
  assert.equal(observe(enabled.checkpoint, 4, "unavailable").event, null);
});
