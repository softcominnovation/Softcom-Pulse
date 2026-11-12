import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { Script, createContext } from "node:vm";

const script = new Script(readFileSync(new URL("../public/incident-highlights.js", import.meta.url), "utf8"));
test("only the visible target's last confirmed recovery starts a five-second border", t => {
  t.mock.timers.enable({ apis: ["Date", "setTimeout"], now: 100000 });
  let states;
  const scope = createContext({ Date, setTimeout, clearTimeout });
  script.runInContext(scope);
  const reducer = scope.PulseIncidentHighlights.create(next => { states = { ...next }; }, ref => ref === "redis" && states.redis === "error");
  const change = (id, ref, status, highlighted = false, at = Date.now()) => ({
    payload: { incident: { id, targetRef: ref, status, closedAt: new Date(at).toISOString() }, highlighted },
  });
  const apply = (...changes) => reducer.apply(changes, Date.now(), 60000);
  reducer.replace([{ incidentId: "1", targetRef: "redis" }, { incidentId: "2", targetRef: "redis" }]);
  apply({ kind: "read", payload: { ids: ["1"] } }, change("1", "redis", "resolved"));
  assert.deepEqual(states, { redis: "error" });
  const resolved = change("2", "redis", "resolved");
  apply(resolved);
  assert.deepEqual(states, { redis: "recovered" });
  t.mock.timers.tick(4999);
  apply(resolved);
  assert.equal(states.redis, "recovered");
  t.mock.timers.tick(1);
  assert.deepEqual(states, {});
  apply(change("3", "redis", "active", true), change("3", "redis", "resolved"));
  assert.deepEqual(states, {});
  apply(change("4", "redis", "active", true));
  apply(change("4", "redis", "resolved"));
  apply(change("5", "redis", "active", true));
  t.mock.timers.tick(5000);
  assert.equal(states.redis, "error");
  apply(change("5", "redis", "cancelled"), change("6", "other", "active", true));
  assert.deepEqual(states, { other: "error" });
  apply(change("6", "other", "resolved"));
  assert.deepEqual(states, {});
  apply(change("7", "redis", "active", true));
  apply(change("7", "redis", "resolved", false, Date.now() - 61000));
  assert.deepEqual(states, {});
  apply(change("8", "redis", "active", true), change("9", "other", "active", true));
  assert.deepEqual(states, { redis: "error", other: "error" });
  apply(change("8", "redis", "active", false));
  assert.deepEqual(states, { other: "error" });
  reducer.replace([]);
  assert.deepEqual(states, {});
  reducer.dispose();
});
