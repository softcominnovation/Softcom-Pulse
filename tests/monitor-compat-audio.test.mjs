import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const source = await readFile(new URL("../public/monitor-compat-audio.js", import.meta.url), "utf8");
function adapter(blocked, { resumeBlocked = false } = {}) {
  const preferences = new Map(), voices = [];
  let now = 1_000_000;
  class Clock extends Date { static now() { return now; } }
  class Context {
    state = resumeBlocked ? "suspended" : "running";
    destination = {};
    resume() { return resumeBlocked ? Promise.reject(new Error("Autoplay blocked")) : Promise.resolve(); }
    decodeAudioData(bytes, success) { success({ wav: bytes }); }
    createGain() { return { gain: { value: 0 }, connect() {}, disconnect() {} }; }
    createBufferSource() {
      const voice = { starts: 0, stops: 0, connect(gain) { this.gain = gain; }, disconnect() {}, start() { this.starts++; }, stop() { this.stops++; } };
      voices.push(voice); return voice;
    }
  }
  class Xhr {
    open(_method, path) { assert.match(path, /^\/monitor\/compat\/audio\/(notification|warning|error|success)$/); this.path = path; }
    send() { this.status = 200; this.response = this.path.split('/').at(-1); this.onload(); }
  }
  const globals = { window: { AudioContext: Context, addEventListener() {} }, navigator: {}, XMLHttpRequest: Xhr, setTimeout, clearTimeout, Date: Clock };
  Object.defineProperty(globals, "localStorage", { get() {
    if (blocked) throw new Error("Storage blocked");
    return { getItem: key => preferences.get(key) ?? null, setItem: (key, value) => preferences.set(key, value) };
  } });
  vm.runInNewContext(source, globals);
  return { audio: globals.window.PulseCompatibleAudio, voices, advance: ms => { now += ms; }, preferences };
}

for (const blocked of [false, true]) test(`classic arrivals initialize audio without the test button, then play recovery with storage blocked=${blocked}`, async () => {
  const { audio, voices, advance } = adapter(blocked);
  const settle = () => new Promise(resolve => setImmediate(resolve));
  audio.deliver([{ id: 'alert', sound: 'error', severity: 'critical' }], 15000); await settle();
  assert.equal(voices.length, 1);
  assert.equal(voices[0].buffer.wav, 'error');
  assert.equal(voices[0].gain.gain.value, 0.5 * 0.65);
  advance(16000);
  audio.deliver([{ id: 'recovered', sound: 'success', severity: 'info' }], 15000); await settle();
  assert.equal(voices.length, 2);
  assert.equal(voices[1].buffer.wav, 'success');
  assert.equal(voices[1].gain.gain.value, 0.5 * 0.45);
  advance(16000);
  audio.deliver([{ id: 'policy-silent', sound: false, severity: 'info' }], 15000); await settle();
  assert.equal(voices.length, 2, 'A disabled recovery sound must remain disabled');
});

test('classic blocked autoplay never claims or queues an alarm', async () => {
  const { audio, voices, preferences } = adapter(false, { resumeBlocked: true });
  audio.deliver([{ id: 'blocked', sound: 'error', severity: 'critical' }], 15000);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(voices.length, 0);
  assert.equal(preferences.has('pulse-notification-last-sound'), false);
  audio.prepare(); await new Promise(resolve => setImmediate(resolve));
  assert.equal(voices.length, 0);
});

for (const blocked of [false, true]) test(`classic operational WAV adapter respects mute, zero and dedup with storage blocked=${blocked}`, async () => {
  const { audio, voices } = adapter(blocked);
  const deliver = id => audio.deliver([{ id, sound: "warning", severity: "warning" }], 15000);
  const settle = () => new Promise(resolve => setImmediate(resolve));
  assert.equal(audio.prepare(), true);
  audio.setMuted(true); deliver("muted"); await settle(); assert.equal(voices.length, 0);
  audio.setMuted(false); audio.setVolume(0); deliver("zero"); await settle(); assert.equal(voices.length, 0);
  audio.setVolume(0.4); deliver("current"); await settle();
  assert.equal(voices.length, 1); assert.equal(voices[0].starts, 1);
  assert.ok(Math.abs(voices[0].gain.gain.value - 0.18) < 0.0001);
  deliver("current"); await settle(); assert.equal(voices.length, 1);
  audio.setMuted(true); assert.equal(voices[0].gain.gain.value, 0); assert.equal(voices[0].stops, 1);
  audio.setMuted(false); await settle(); assert.equal(voices.length, 1, "unmute must not replay discarded arrivals");
});
