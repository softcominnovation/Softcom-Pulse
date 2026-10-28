import test from "node:test";
import assert from "node:assert/strict";
import { NotificationDelivery, arrivingSound } from "../lib/notifications/delivery.ts";
import { defaultNotificationPolicy, notificationRuntime } from "../lib/notifications/policy.ts";
const runtime = notificationRuntime(defaultNotificationPolicy(), "1");
const now = 1800000000000;
const event = (id, extra = {}) => ({ id, incidentId: `incident-${id}`, announce: true, toastEligible: true, readAt: null, eventType: "unavailable", incidentStatus: "active", createdAt: new Date(now).toISOString(), occurredAt: new Date(now - 120000).toISOString(), severity: "critical", sound: "error", ...extra });
test("delivery groups new confirmations by creation time and never replays an id", () => {
  const delivery = new NotificationDelivery(); delivery.add([event("a"), event("b")], now, runtime);
  assert.equal(delivery.take(now + 1999, runtime), null);
  assert.equal(delivery.take(now + 2000, runtime).events.length, 2);
  delivery.dismissed(now + 10000, runtime); delivery.add([event("a")], now + 20000, runtime);
  assert.equal(delivery.take(now + 22000, runtime), null);
});

test("group summaries count services independently of their conditions and merge overflow", () => {
  const delivery = new NotificationDelivery();
  delivery.add([event("a", { targetRef: "storage:one" }), event("b", { targetRef: "storage:one" })], now, runtime);
  assert.equal(delivery.take(now + 2000, runtime).targetCount, 1);
  delivery.dismissed(now + 2001, runtime);
  for (let index = 0; index < 4; index++) delivery.add([event(`extra${index}`, { targetRef: `resource:${index}` })], now + 3000 + index * 2500, runtime);
  const first = delivery.take(now + 12001, runtime); assert.equal(first.events.length, 1);
  delivery.dismissed(now + 12002, runtime);
  assert.equal(delivery.take(now + 22002, runtime).events.length, 1);
  delivery.dismissed(now + 22003, runtime);
  const summary = delivery.take(now + 32003, runtime);
  assert.equal(summary.events.length, 2); assert.equal(summary.targetCount, 2);
});
test("read and resolved changes cancel pending delivery without changing shared state", () => {
  const delivery = new NotificationDelivery(); delivery.add([event("a"), event("b")], now, runtime);
  delivery.update([], ["a"], ["incident-b"]); assert.equal(delivery.take(now + 3000, runtime), null);
});
test("visual gap, audio cooldown, stale events and recovery remain independent", () => {
  const delivery = new NotificationDelivery(); delivery.add([event("a")], now, runtime);
  assert.equal(delivery.take(now + 2000, runtime).sound, "error"); delivery.dismissed(now + 2001, runtime);
  delivery.add([event("b", { eventType: "recovery", incidentStatus: "resolved", sound: "success" })], now + 3000, runtime);
  assert.equal(delivery.take(now + 12000, runtime), null);
  assert.equal(delivery.take(now + 12001, runtime).sound, false);
  delivery.dismissed(now + 13000, runtime); delivery.add([event("old")], now + 65000, runtime);
  assert.equal(delivery.take(now + 68000, runtime), null);
});
test("reconnect discards pending deliveries and sustained bursts stay bounded", () => {
  const delivery = new NotificationDelivery();
  for (let index = 0; index < 10; index++) delivery.add([event(String(index))], now + index * 2100, runtime);
  let groups = 0;
  for (let time = now + 21000; time < now + 60000; time += 11000) { if (delivery.take(time, runtime)) { groups++; delivery.dismissed(time, runtime); } }
  assert.equal(groups, 3); delivery.reset(); assert.equal(delivery.take(now + 65000, runtime), null);
});
test("a hidden arrival can sound immediately and an old event cannot", () => {
  const cue = arrivingSound([event("a"), event("b", { severity: "warning", sound: "warning" })], now, runtime);
  assert.equal(cue.sound, "error"); assert.equal(cue.velocity, 0.65); assert.deepEqual(cue.ids, ["a", "b"]);
  assert.equal(arrivingSound([event("old", { createdAt: new Date(now - 61000).toISOString() })], now, runtime), null);
  assert.equal(arrivingSound([event("read", { readAt: new Date(now).toISOString() })], now, runtime), null);
  assert.equal(arrivingSound([event("silent", { sound: false })], now, runtime), null);
  const recovered = arrivingSound([
    event("down", { incidentId: "same" }),
    event("up", { incidentId: "same", eventType: "recovery", incidentStatus: "resolved", severity: "info", sound: "success" }),
  ], now, runtime);
  assert.equal(recovered.sound, "error");
  assert.equal(arrivingSound([event("late", { createdAt: new Date(now - 90000).toISOString() })], now, { ...runtime, maxDeliveryAgeMs: 180000 }).sound, "error");
});
