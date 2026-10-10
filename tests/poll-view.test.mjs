import test from "node:test";
import assert from "node:assert/strict";
import { createPollCache, resolvePollView } from "../lib/dashboard/poll-view.ts";

test("resolvePollView keeps live state when the key matches", () => {
  const live = { key: "a:1", data: { screen: "a" }, failed: false, loading: false };
  assert.deepEqual(resolvePollView(live, "a:1", { screen: "cached" }), { data: { screen: "a" }, failed: false, loading: false });
  assert.deepEqual(resolvePollView({ ...live, failed: true, loading: false }, "a:1", undefined), { data: { screen: "a" }, failed: true, loading: false });
});

test("resolvePollView falls back to cache on key change instead of emptying the view", () => {
  const previous = { key: "a:1", data: { screen: "a" }, failed: false, loading: false };
  assert.deepEqual(resolvePollView(previous, "b:1", { screen: "b" }), { data: { screen: "b" }, failed: false, loading: true });
  assert.deepEqual(resolvePollView(previous, "b:1", undefined), { data: null, failed: false, loading: true });
});

test("createPollCache stores and returns values by key", () => {
  const cache = createPollCache();
  assert.equal(cache.get("missing"), undefined);
  cache.set("screen:1", { ok: true });
  assert.deepEqual(cache.get("screen:1"), { ok: true });
  cache.set("screen:1", { ok: false });
  assert.deepEqual(cache.get("screen:1"), { ok: false });
});
