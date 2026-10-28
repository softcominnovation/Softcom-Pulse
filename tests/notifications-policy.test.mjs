import test from "node:test";
import assert from "node:assert/strict";
import { defaultNotificationPolicy, notificationPolicySchema, notificationPolicyWriteSchema,
  notificationOverrideWriteSchema, notificationDecision, notificationRuntime } from "../lib/notifications/policy.ts";

const targetRef = "storage:00000000-0000-4000-8000-000000000001";
const event = { targetRef, critical: true, monitoringEnabled: true, eventType: "unavailable", severity: "critical" };

test("notification defaults select critical services, high problems and silent recovery", () => {
  const policy = defaultNotificationPolicy();
  assert.deepEqual(notificationDecision(policy, event), { enabled: true, sound: "error" });
  assert.equal(notificationDecision(policy, { ...event, critical: false }).enabled, false);
  assert.equal(notificationDecision(policy, { ...event, eventType: "attention", severity: "warning" }).enabled, false);
  assert.equal(notificationDecision(policy, { ...event, eventType: "problem", sourceSeverity: 3 }).enabled, false);
  assert.equal(notificationDecision(policy, { ...event, eventType: "problem", sourceSeverity: 4 }).sound, "error");
  assert.equal(notificationDecision(policy, { ...event, eventType: "problem" }).enabled, false);
  assert.deepEqual(notificationDecision(policy, { ...event, eventType: "recovery", previouslyAnnounced: true }), { enabled: true, sound: false });
  assert.equal(notificationDecision(policy, { ...event, eventType: "recovery" }).enabled, false);
});

test("target exceptions cannot bypass global, lifecycle or event sound gates", () => {
  const policy = defaultNotificationPolicy();
  policy.overrides[targetRef] = { mode: "on", sound: "on", events: { attention: true } };
  assert.equal(notificationDecision(policy, { ...event, critical: false }).sound, "error");
  assert.deepEqual(notificationDecision(policy, { ...event, eventType: "attention", severity: "warning" }), { enabled: true, sound: false });
  assert.equal(notificationDecision(policy, { ...event, monitoringEnabled: false }).enabled, false);
  policy.sounds.enabled = false;
  assert.deepEqual(notificationDecision(policy, event), { enabled: true, sound: false });
  policy.enabled = false;
  assert.deepEqual(notificationDecision(policy, event), { enabled: false, sound: false });
  policy.enabled = true; policy.sounds.enabled = true;
  policy.overrides[targetRef].mode = "off";
  assert.deepEqual(notificationDecision(policy, event), { enabled: false, sound: false });
});

test("notification settings validate boundaries, canonical targets and strict schemas", () => {
  const policy = defaultNotificationPolicy();
  for (const patch of [{ toastLifetimeMs: 3999 }, { toastLifetimeMs: 15001 }, { soundCooldownMs: 0 },
    { retentionDays: 366 }, { minimumProblemSeverity: 6 }, { schemaVersion: 2 }, { extra: true },
    { overrides: { "storage:not-a-uuid": {} } }, { sounds: { information: true } }]) {
    assert.equal(notificationPolicySchema.safeParse({ ...policy, ...patch }).success, false, JSON.stringify(patch));
  }
  const overrides = Object.fromEntries(Array.from({ length: 1001 }, (_, i) => [`storage:00000000-0000-4000-8000-${String(i).padStart(12, "0")}`, {}]));
  assert.equal(notificationPolicySchema.safeParse({ ...policy, overrides }).success, false);
  assert.equal(notificationOverrideWriteSchema.safeParse({ expectedRevision: 1, override: null }).success, true);
  assert.equal(notificationPolicyWriteSchema.safeParse({ expectedRevision: 0, settings: {} }).success, false);
  assert.equal(notificationPolicyWriteSchema.safeParse({ expectedRevision: 1, settings: {} }).success, true);
});

test("safe runtime excludes target exceptions and serializes large delivery revisions", () => {
  const policy = defaultNotificationPolicy(); policy.overrides[targetRef] = { mode: "off", sound: "off" };
  const runtime = notificationRuntime(policy, 9007199254740993n);
  assert.equal(runtime.deliveryRevision, "9007199254740993");
  assert.equal(runtime.visualGapMs, 10000);
  assert.equal(runtime.toastPosition, "header-center");
  const legacy = { ...defaultNotificationPolicy() };
  delete legacy.toastPosition;
  assert.equal(notificationPolicySchema.parse(legacy).toastPosition, "header-center");
  assert.equal(JSON.stringify(runtime).includes(targetRef), false);
  assert.doesNotThrow(() => JSON.stringify(runtime));
});

test("partial event overrides preserve inheritance instead of injecting global defaults", () => {
  const policy = notificationPolicySchema.parse({
    ...defaultNotificationPolicy(), events: { unavailable: false },
    overrides: { [targetRef]: { events: { attention: true } } },
  });
  assert.deepEqual(policy.overrides[targetRef].events, { attention: true });
  assert.equal(notificationDecision(policy, event).enabled, false);
});
