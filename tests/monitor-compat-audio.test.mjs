import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const source = await readFile(new URL("../public/monitor-compat-audio.js", import.meta.url), "utf8");
function adapter(blocked) {
  const preferences = new Map(), voices = [];
  class Context {
    state = "running";
    destination = {};
    resume() { return Promise.resolve(); }
    decodeAudioData(_bytes, success) { success({ wav: true }); }
    createGain() { return { gain: { value: 0 }, connect() {}, disconnect() {} }; }
    createBufferSource() {
      const voice = { starts: 0, stops: 0, connect(gain) { this.gain = gain; }, disconnect() {}, start() { this.starts++; }, stop() { this.stops++; } };
      voices.push(voice); return voice;
    }
  }
  class Xhr {
    open(_method, path) { assert.match(path, /^\/monitor\/compat\/audio\/(notification|warning|error|success)$/); }
    send() { this.status = 200; this.response = new ArrayBuffer(4); this.onload(); }
  }
  const globals = { window: { AudioContext: Context, addEventListener() {} }, navigator: {}, XMLHttpRequest: Xhr, setTimeout, clearTimeout };
  Object.defineProperty(globals, "localStorage", { get() {
    if (blocked) throw new Error("Storage blocked");
    return { getItem: key => preferences.get(key) ?? null, setItem: (key, value) => preferences.set(key, value) };
  } });
  vm.runInNewContext(source, globals);
  return { audio: globals.window.PulseCompatibleAudio, voices };
}

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
