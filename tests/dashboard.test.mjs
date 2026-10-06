import { test } from "node:test";
import assert from "node:assert/strict";
import { createPlayerStore, playableScreens } from "../lib/dashboard/player.ts";
import { metricValue, isOld, qualityText } from "../lib/dashboard/format.ts";

function document(count = 3, revision = 1, autoStart = false) {
  return { schemaVersion: 1, revision, defaultTvMode: false, rotation: { autoStart, intervalSeconds: 5 }, screens: Array.from({ length: count }, (_, i) => ({ id: `screen-${i}`, name: `Tela ${i}`, enabled: true, layout: i === 1 ? "wall" : "overview", blocks: [{ id: `block-${i}`, type: "summary", enabled: true, width: "full" }] })) };
}
test("one screen stays static; two/three rotate in saved order and stop at the current screen", () => {
  for (const count of [1, 2, 3]) {
    const store = createPlayerStore(), action = store.getState(); action.configure(document(count), 0); action.start(0);
    assert.equal(store.getState().rotating, count > 1);
    for (let step = 1; step <= count + 1; step++) { action.tick(step * 5000); assert.equal(store.getState().screenId, `screen-${count === 1 ? 0 : step % count}`); }
    const selected = store.getState().screenId; action.stop(); action.tick(999999); assert.equal(store.getState().screenId, selected);
  }
});
test("reading, hidden tab and dialog pauses compose and resume with a full interval", () => {
  const store = createPlayerStore(), action = store.getState(); action.configure(document(3, 1, true), 0); action.tick(2000);
  action.block("hidden", true, 2000); action.block("dialog", true, 3000); action.tick(60000); assert.equal(store.getState().remaining, 3);
  action.block("hidden", false, 61000); assert.equal(store.getState().deadline, null);
  action.block("dialog", false, 62000); assert.equal(store.getState().deadline, 67000);
  action.pause(); action.block("hidden", true, 64000); action.block("hidden", false, 70000); action.tick(99000);
  assert.equal(store.getState().screenId, "screen-0"); action.start(100000); action.tick(104999); assert.equal(store.getState().screenId, "screen-0");
  action.tick(105000); assert.equal(store.getState().screenId, "screen-1");
});
test("manual selection pauses and formats stop without changing the persisted document", () => {
  const store = createPlayerStore(), action = store.getState(), saved = document(3); action.configure(saved, 0); action.start(0);
  action.step(1); action.tick(20000); assert.equal(store.getState().screenId, "screen-1"); assert.equal(store.getState().readingPaused, true);
  action.format("overview"); assert.equal(store.getState().rotating, false); assert.equal(store.getState().layoutOverride, "overview"); assert.deepEqual(store.getState().document, saved);
});
test("new revisions wait for slide boundary or resume; old revisions cannot replace pending ones", () => {
  const store = createPlayerStore(), action = store.getState(); action.configure(document(3, 1, true), 0);
  const next = document(3, 2); next.rotation.intervalSeconds = 10; next.screens.reverse(); action.configure(next, 1000);
  assert.equal(store.getState().document.revision, 1); action.configure(document(3, 1), 2000); action.tick(5000);
  assert.equal(store.getState().document.revision, 2); assert.equal(store.getState().screenId, "screen-2"); assert.equal(store.getState().remaining, 10);
  action.pause(); action.configure(document(3, 3), 6000); action.tick(99999); assert.equal(store.getState().document.revision, 2);
  action.start(100000); assert.equal(store.getState().document.revision, 3); assert.equal(store.getState().remaining, 5);
  action.block("hidden", true, 101000); action.configure(document(3, 4), 102000);
  action.block("hidden", false, 110000); assert.equal(store.getState().document.revision, 4); assert.equal(store.getState().deadline, 115000);
  action.stop(); action.block("dialog", true, 111000); action.configure(document(3, 5, true), 112000);
  action.block("dialog", false, 120000); assert.equal(store.getState().document.revision, 5); assert.equal(store.getState().rotating, false);
});
test("removed screen is replaced immediately; remote autoStart never overrides a local stop", () => {
  const store = createPlayerStore(), action = store.getState(); action.configure(document(3, 1, true), 0); action.select("screen-2");
  action.configure(document(2, 2), 1000); assert.equal(store.getState().screenId, "screen-0"); assert.ok(store.getState().notice);
  action.stop(); action.configure(document(3, 3, true), 2000); assert.equal(store.getState().rotating, false);
  const unavailable = document(1, 4); unavailable.screens[0].blocks[0].enabled = false; action.configure(unavailable, 3000);
  assert.equal(playableScreens(store.getState().document).length, 0); assert.equal(store.getState().screenId, null);
});
test("metric formatting preserves zero, units, unsupported and evidence age", () => {
  const metric = { value: 0, unit: "percent", quality: "fresh", observedAt: "2026-10-03T00:00:00Z", validUntil: "2026-10-03T00:01:00Z" };
  assert.equal(metricValue(metric), "0%"); assert.equal(metricValue(undefined), "Sem dados");
  assert.equal(metricValue({ ...metric, quality: "unsupported", value: 45 }), "Sem dados");
  assert.equal(metricValue({ ...metric, value: 1048576, unit: "bytes" }), "1 MiB");
  assert.equal(metricValue({ ...metric, value: 1000000, unit: "bits/s" }), "1 Mbit/s");
  assert.equal(metricValue({ ...metric, value: 125.5 }), "125,5%");
  assert.equal(isOld(metric, false, Date.parse("2026-10-03T00:02:00Z")), true);
  assert.equal(qualityText(metric, true, 0), "Dado desatualizado");
});
