import { test, expect } from "@playwright/experimental-ct-react";
import { NotificationToastFixture } from "../fixtures/notification-toast";

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
