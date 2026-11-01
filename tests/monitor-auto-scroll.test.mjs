import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";

const context = {};
runInNewContext(await readFile(new URL("../public/monitor-auto-scroll.js", import.meta.url), "utf8"), context);
const { createMotion } = context.PulseMonitorAutoScroll;

test("monitor motion uses 24 CSS pixels per second after a two-second reading pause", () => {
  const motion = createMotion(0);
  for (let time = 100; time < 2000; time += 100) assert.equal(motion.step(time, 1000), 0);
  for (let time = 2000; time < 3000; time += 100) motion.step(time, 1000);
  assert.ok(Math.abs(motion.getPosition() - 24) < 0.0001);
});

test("monitor motion reaches both ends, pauses and reverses without snapping to the start", () => {
  const motion = createMotion(0);
  for (let time = 100; time <= 3000; time += 100) motion.step(time, 24);
  assert.equal(motion.getPosition(), 24);
  for (let time = 3100; time < 4900; time += 100) assert.equal(motion.step(time, 24), 24);
  for (let time = 4900; time <= 6100; time += 100) motion.step(time, 24);
  assert.equal(motion.getPosition(), 0);
  assert.equal(motion.step(6200, 24), 0);
});

test("holding a manual position pauses before resuming and long interruptions cannot skip rows", () => {
  const motion = createMotion(0);
  motion.hold(33, 5000);
  assert.equal(motion.step(6900, 100), 33);
  assert.ok(Math.abs(motion.step(100000, 100) - 35.4) < 0.0001);
  const position = motion.getPosition();
  assert.equal(motion.step(99900, 100), position);
});

test("motion clamps a shrinking region and resets when content no longer overflows", () => {
  const motion = createMotion(0);
  motion.hold(200, 0);
  assert.equal(motion.step(100, 50), 50);
  assert.equal(motion.step(200, 1), 0);
  assert.equal(motion.step(2100, 200), 0);
});

test("capturing the DOM before refresh preserves the pending position, direction and reading pause", () => {
  const motion = createMotion(0);
  motion.hold(5, 1000);
  motion.capture(17);
  assert.equal(motion.step(2900, 100), 17);
  assert.ok(Math.abs(motion.step(3000, 100) - 19.4) < 0.0001);
});
