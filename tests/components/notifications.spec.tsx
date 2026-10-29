import { test, expect } from "@playwright/experimental-ct-react";
import { NotificationToastFixture } from "../fixtures/notification-toast";
import { observeAudio } from "../fixtures/audio";

test("an unactivated page stays silent and does not replay its alert after the first interaction", async ({ mount, page }) => {
  await observeAudio(page); await page.evaluate(() => localStorage.clear()); await mount(<NotificationToastFixture />);
  const played = await page.evaluate(() => new Promise<boolean>(complete => {
    Object.defineProperty(document, "hidden", { value: true, configurable: true });
    window.dispatchEvent(new CustomEvent("test:background-sound", { detail: { complete } }));
  }));
  expect(played).toBe(false); expect(await page.evaluate(() => window.pulseAudioTest.contexts.length)).toBe(0);
  await page.evaluate(() => { Object.defineProperty(document, "hidden", { value: false, configurable: true }); window.pulseAudioTest.recording = true; });
  await page.getByLabel("Entrada sem efeito sonoro").click(); await page.waitForTimeout(500);
  expect(await page.evaluate(() => window.pulseAudioTest.starts)).toBe(0);
});

test("a quiet trusted interaction prepares decoded audio and a hidden arrival renders the WAV", async ({ mount, page }) => {
  await observeAudio(page); await page.evaluate(() => { localStorage.clear(); window.pulseAudioTest.recording = true; });
  await mount(<NotificationToastFixture />);
  await page.getByLabel("Entrada sem efeito sonoro").click();
  await expect.poll(() => page.evaluate(() => window.pulseAudioTest.contexts[0]?.state)).toBe("running");
  expect(await page.evaluate(() => window.pulseAudioTest.contexts.length)).toBe(1);
  expect(await page.evaluate(() => window.pulseAudioTest.starts)).toBe(0);
  const played = await page.evaluate(async () => {
    Object.defineProperty(document, "hidden", { value: true, configurable: true });
    window.pulseAudioTest.recording = true;
    return new Promise<boolean>(complete => window.dispatchEvent(new CustomEvent("test:background-sound", { detail: { complete } })));
  });
  expect(played).toBe(true);
  await expect.poll(() => page.evaluate(() => window.pulseAudioTest.bufferStarts)).toBeGreaterThan(0);
  await expect.poll(() => page.evaluate(() => window.pulseAudioTest.audible)).toBeGreaterThan(0);
  await expect(page.locator('[data-operational-toast]')).toHaveCount(0);
});

test('a suspended unlocked context resumes and renders a background arrival', async ({ mount, page }) => {
  await observeAudio(page); await page.evaluate(() => localStorage.clear()); await mount(<NotificationToastFixture />);
  await page.getByLabel('Entrada sem efeito sonoro').click();
  const played = await page.evaluate(async () => {
    await window.pulseAudioTest.contexts[0].suspend();
    Object.defineProperty(document, 'hidden', { value: true, configurable: true });
    window.pulseAudioTest.recording = true;
    return new Promise<boolean>(complete => window.dispatchEvent(new CustomEvent('test:background-sound', { detail: { complete } })));
  });
  expect(played).toBe(true);
  expect(await page.evaluate(() => window.pulseAudioTest.contexts[0].state)).toBe('running');
  await expect.poll(() => page.evaluate(() => window.pulseAudioTest.audible)).toBeGreaterThan(0);
});

test("blocked context does not queue an alert for a later focus", async ({ mount, page }) => {
  await observeAudio(page); await page.evaluate(() => localStorage.clear()); await mount(<NotificationToastFixture />);
  await page.getByLabel("Entrada sem efeito sonoro").click();
  const played = await page.evaluate(async () => {
    await window.pulseAudioTest.contexts[0].suspend();
    AudioContext.prototype.resume = () => new Promise<void>(() => {});
    Object.defineProperty(document, "hidden", { value: true, configurable: true }); window.pulseAudioTest.recording = true;
    return new Promise<boolean>(complete => window.dispatchEvent(new CustomEvent("test:background-sound", { detail: { complete } })));
  });
  expect(played).toBe(false);
  await page.evaluate(async () => {
    Object.defineProperty(document, "hidden", { value: false, configurable: true }); document.dispatchEvent(new Event("visibilitychange"));
  });
  await page.waitForTimeout(500);
  expect(await page.evaluate(() => window.pulseAudioTest.starts)).toBe(0);
  expect(await page.evaluate(() => window.pulseAudioTest.bufferStarts)).toBe(0);
});

for (const control of ["Silenciar áudio", "Volume zero"]) test(`hidden arrivals obey ${control}`, async ({ mount, page }) => {
  await observeAudio(page); await page.evaluate(() => localStorage.clear()); await mount(<NotificationToastFixture />);
  await page.getByRole("button", { name: control, exact: true }).click();
  const result = await page.evaluate(async () => {
    Object.defineProperty(document, "hidden", { value: true, configurable: true }); window.pulseAudioTest.recording = true;
    const played = await new Promise<boolean>(complete => window.dispatchEvent(new CustomEvent("test:background-sound", { detail: { complete } })));
    return { played, starts: window.pulseAudioTest.starts };
  });
  expect(result).toEqual({ played: false, starts: 0 });
});

for (const control of ["Silenciar áudio", "Volume zero"]) test(`a decoded notification already playing stops on ${control}`, async ({ mount, page }) => {
  await observeAudio(page); await page.evaluate(() => localStorage.clear()); await mount(<NotificationToastFixture />);
  await page.getByLabel("Entrada sem efeito sonoro").click();
  await page.evaluate(() => {
    const stop = AudioBufferSourceNode.prototype.stop;
    Object.defineProperty(window, 'notificationStops', { value: 0, writable: true });
    AudioBufferSourceNode.prototype.stop = function (...args) {
      (window as typeof window & { notificationStops: number }).notificationStops++;
      return stop.apply(this, args);
    };
    window.pulseAudioTest.recording = true;
  });
  const played = await page.evaluate(() => new Promise<boolean>(complete => window.dispatchEvent(new CustomEvent("test:background-sound", { detail: { complete } }))));
  expect(played).toBe(true);
  expect(await page.evaluate(() => window.pulseAudioTest.bufferStarts)).toBeGreaterThan(0);
  await page.getByRole("button", { name: control, exact: true }).click();
  expect(await page.evaluate(() => (window as typeof window & { notificationStops: number }).notificationStops)).toBeGreaterThan(0);
});

for (const action of ["Notificar e silenciar", "Notificar e zerar"]) test(`${action} cuts already scheduled oscillator voices within 100ms`, async ({ mount, page }) => {
  await page.evaluate(() => {
    localStorage.clear();
    const stops = new Map<OscillatorNode, number[]>(), original = OscillatorNode.prototype.stop;
    Object.defineProperty(window, "voiceStopDeadlines", { value: () => [...stops.values()].filter(times => times.length > 1).map(times => times.at(-1)) });
    OscillatorNode.prototype.stop = function (when = 0) {
      const times = stops.get(this) ?? []; times.push(when - this.context.currentTime); stops.set(this, times);
      return original.call(this, when);
    };
  });
  await mount(<NotificationToastFixture />);
  await page.getByRole("button", { name: action, exact: true }).click();
  const deadlines = await page.evaluate(() => (window as typeof window & { voiceStopDeadlines: () => number[] }).voiceStopDeadlines());
  expect(deadlines.length).toBeGreaterThan(0);
  expect(deadlines.every(delay => delay >= 0 && delay <= 0.1)).toBe(true);
});

test("operational toast expires under stationary hover but honors keyboard focus", async ({ mount, page }) => {
  await mount(<NotificationToastFixture />);
  await page.getByRole("button", { name: "Novo incidente" }).click();
  const pill = page.locator('[data-operational-toast="operational-test"]');
  await pill.hover();
  await expect(pill).toHaveCount(0, { timeout: 3500 });
  await page.getByRole("button", { name: "Novo incidente" }).click();
  await page.getByRole("button", { name: "Ver central" }).focus();
  await page.waitForTimeout(1300);
  await expect(pill).toBeVisible();
  await page.getByRole("button", { name: "Novo incidente" }).focus();
  await expect(pill).toHaveCount(0, { timeout: 3500 });
});

test("zero persists as silence and restoring volume never replays a notification", async ({ mount, page }) => {
  await page.evaluate(() => {
    localStorage.clear();
    const original = OscillatorNode.prototype.start;
    Object.defineProperty(window, "notificationAudioStarts", { value: 0, writable: true, configurable: true });
    OscillatorNode.prototype.start = function (...args) {
      const scope = window as typeof window & { notificationAudioStarts: number };
      scope.notificationAudioStarts++; return original.apply(this, args);
    };
  });
  const component = await mount(<NotificationToastFixture />);
  await page.getByRole("button", { name: "Volume zero" }).click();
  await expect(page.getByTestId("audio-preferences")).toHaveText("on:0");
  const starts = await page.evaluate(() => (window as typeof window & { notificationAudioStarts: number }).notificationAudioStarts);
  await page.getByRole("button", { name: "Novo incidente" }).click();
  await expect(page.getByText("Storage indisponível")).toBeVisible();
  expect(await page.evaluate(() => (window as typeof window & { notificationAudioStarts: number }).notificationAudioStarts)).toBe(starts);
  await component.unmount(); await mount(<NotificationToastFixture />);
  await expect(page.getByTestId("audio-preferences")).toHaveText("on:0");
  await expect(page.getByText("Storage indisponível")).toHaveCount(0);
  await page.getByRole("button", { name: "Ativar áudio" }).click();
  await expect(page.getByTestId("audio-preferences")).toHaveText("on:0.5");
  const afterRestore = await page.evaluate(() => (window as typeof window & { notificationAudioStarts: number }).notificationAudioStarts);
  await page.waitForTimeout(1200);
  expect(await page.evaluate(() => (window as typeof window & { notificationAudioStarts: number }).notificationAudioStarts)).toBe(afterRestore);
  await expect(page.getByText("Storage indisponível")).toHaveCount(0);
});
