import type { Page, BrowserContext } from "@playwright/test";

function installAudioObservation() {
    if (window.pulseAudioTest) return;
    const audio = { contexts: [] as AudioContext[], sources: [] as AudioBufferSourceNode[], bufferStarts: 0, recording: false, starts: 0, audible: 0 };
    Object.defineProperty(window, "pulseAudioTest", { value: audio });
    const startBuffer = AudioBufferSourceNode.prototype.start;
    AudioBufferSourceNode.prototype.start = function (...args: Parameters<AudioBufferSourceNode['start']>) {
      if (this.buffer && audio.recording && this.context.state === 'running') { audio.bufferStarts++; audio.sources.push(this); }
      return startBuffer.apply(this, args);
    };
    const NativeContext = window.AudioContext;
    window.AudioContext = class extends NativeContext {
      constructor(options?: AudioContextOptions) { super(options); audio.contexts.push(this); }
    };
    const start = OscillatorNode.prototype.start;
    OscillatorNode.prototype.start = function (when?: number) {
      if (audio.recording && this.context.state === "running") audio.starts++;
      return start.call(this, when);
    };
    const connect = AudioNode.prototype.connect;
    Object.defineProperty(AudioNode.prototype, "connect", { value: function (this: AudioNode, destination: AudioNode | AudioParam, ...ports: number[]) {
      const result = Reflect.apply(connect, this, [destination, ...ports]);
      if (destination instanceof AudioDestinationNode) {
        const analyser = this.context.createAnalyser(); analyser.fftSize = 256;
        Reflect.apply(connect, this, [analyser]);
        const samples = new Float32Array(256);
        setInterval(() => {
          if (!audio.recording) return;
          analyser.getFloatTimeDomainData(samples);
          if (samples.some(sample => Math.abs(sample) > 0.0001)) audio.audible++;
        }, 20);
      }
      return result;
    } });
}
export async function observeAudio(target: Page | BrowserContext) {
  await target.addInitScript(installAudioObservation);
  if ("evaluate" in target) await target.evaluate(installAudioObservation);
}

declare global {
  interface Window {
    pulseAudioTest: { contexts: AudioContext[]; sources: AudioBufferSourceNode[]; bufferStarts: number; recording: boolean; starts: number; audible: number };
  }
}
