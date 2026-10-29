import { test, expect } from '@playwright/test';
import { adminFixture } from '../fixtures/admin';
import { signIn } from '../fixtures/infrastructure';
import { notificationFixture, notificationFixtureState, addNotification } from '../fixtures/notifications';
import { observeAudio } from '../fixtures/audio';
import { nativeBrowser } from '../fixtures/native-browser';

test.skip(process.platform !== 'win32', 'Native window background regression runs on Windows; component tests cover portable audio behavior.');

// Focus emulation in headless Chromium cannot reproduce leaving a native browser tab.
test.use({ headless: false, launchOptions: {
  args: ["--autoplay-policy=user-gesture-required"],
  ignoreDefaultArgs: ['--disable-background-timer-throttling', '--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding'],
} });

test('a genuinely minimized window renders a new alert without a visibility override', async ({ baseURL }) => {
  test.setTimeout(45000);
  const native = await nativeBrowser();
  try {
  const context = native.context, page = context.pages()[0] ?? await context.newPage();
  await observeAudio(page);
  const state = await notificationFixture(page); await adminFixture(page);
  await page.goto(`${baseURL}/login`);
  await page.getByLabel('E-mail', { exact: true }).fill('infra@example.test');
  await page.getByLabel('Senha', { exact: true }).fill('test-password');
  await page.getByRole('button', { name: 'Entrar', exact: true }).click();
  await page.waitForURL(`${baseURL}/`);
  await expect(page.getByRole('button', { name: 'Notificações: 0 não lidas, 0 incidentes atuais', exact: true })).toBeVisible();
  await page.locator('.pulse-brand-caption').click();
  const session = await context.newCDPSession(page);
  const { windowId } = await session.send('Browser.getWindowForTarget');
  try {
    await session.send('Browser.setWindowBounds', { windowId, bounds: { windowState: 'minimized' } });
    await expect.poll(() => page.evaluate(() => document.hidden)).toBe(true);
    await page.evaluate(() => { window.pulseAudioTest.recording = true; });
    addNotification(state);
    await expect.poll(() => page.evaluate(() => window.pulseAudioTest.bufferStarts), { timeout: 16000 }).toBe(1);
    await expect.poll(() => page.evaluate(() => window.pulseAudioTest.audible)).toBeGreaterThan(0);
    expect(await page.evaluate(() => document.hidden)).toBe(true);
    await expect(page.locator('[data-operational-toast]')).toHaveCount(0);
  } finally { await session.send('Browser.setWindowBounds', { windowId, bounds: { windowState: 'normal' } }); }
  } finally { await native.close(); }
});

test("a background arrival renders audio immediately, without a toast or replay on focus", async ({ page, context }) => {
  test.setTimeout(45000);
  await observeAudio(page);
  const state = await notificationFixture(page); await adminFixture(page); await signIn(page);
  await expect(page.getByRole("button", { name: "Notificações: 0 não lidas, 0 incidentes atuais", exact: true })).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.pulseAudioTest.contexts[0]?.state)).toBe("running");
  const session = await context.newCDPSession(page);
  await session.send("Emulation.setFocusEmulationEnabled", { enabled: false });
  const other = await context.newPage(); await other.goto("about:blank"); await other.bringToFront();
  await expect.poll(() => page.evaluate(() => document.hasFocus())).toBe(false);
  // Chromium automation forces visibility even on a background tab; exercise its hidden-page branch explicitly.
  await page.evaluate(() => {
    Object.defineProperty(document, "hidden", { configurable: true, value: true }); document.dispatchEvent(new Event("visibilitychange"));
    window.pulseAudioTest.recording = true;
  });
  addNotification(state);
  await expect.poll(() => page.evaluate(() => window.pulseAudioTest.bufferStarts), { timeout: 16000 }).toBeGreaterThan(0);
  await expect(page.locator('[data-operational-toast]')).toHaveCount(0);
  expect(await page.evaluate(() => window.pulseAudioTest.contexts.length)).toBe(1);
  const starts = await page.evaluate(() => window.pulseAudioTest.bufferStarts);
  await page.evaluate(() => { Object.defineProperty(document, "hidden", { configurable: true, value: false }); document.dispatchEvent(new Event("visibilitychange")); });
  await page.bringToFront(); await expect.poll(() => state.snapshots).toBeGreaterThan(1);
  await page.waitForTimeout(2500);
  expect(await page.evaluate(() => window.pulseAudioTest.bufferStarts)).toBe(starts);
  await expect(page.locator('[data-operational-toast]')).toHaveCount(0);
  await other.close();
});

test("blocked background context leaves the sound available to an activated visible tab", async ({ page, context }) => {
  test.setTimeout(45000); await observeAudio(context);
  const state = notificationFixtureState(); await adminFixture(page); await notificationFixture(page, state); await signIn(page);
  const other = await context.newPage(); await adminFixture(other); await notificationFixture(other, state); await other.goto("/");
  let release = () => {};
  const waiting = new Promise<void>(resolve => { release = resolve; });
  await other.route("**/notifications/changes?*", async route => { await waiting; await route.fallback(); });
  try {
    for (const tab of [page, other]) {
      await expect(tab.getByRole("button", { name: "Notificações: 0 não lidas, 0 incidentes atuais", exact: true })).toBeVisible();
      await tab.locator(".pulse-brand-caption").click();
    }
    await page.evaluate(async () => {
      await window.pulseAudioTest.contexts[0].suspend();
      AudioContext.prototype.resume = () => new Promise<void>(() => {});
      Object.defineProperty(document, "hidden", { configurable: true, value: true }); document.dispatchEvent(new Event("visibilitychange"));
      window.pulseAudioTest.recording = true;
    });
    await other.evaluate(() => { window.pulseAudioTest.recording = true; });
    const event = addNotification(state);
    await expect(page.getByRole("button", { name: /^Notificações: 1 não lidas/ })).toBeAttached({ timeout: 15000 });
    // Wait out the bounded resume attempt before allowing the second tab to consume the feed.
    await page.waitForTimeout(1700);
    expect(await page.evaluate(id => localStorage.getItem("pulse-notification-claims:private")?.includes(id) ?? false, event.id)).toBe(false);
    expect(await page.evaluate(() => window.pulseAudioTest.starts)).toBe(0);
    release();
    await expect.poll(() => other.evaluate(() => window.pulseAudioTest.bufferStarts), { timeout: 16000 }).toBeGreaterThan(0);
    await expect(other.locator('[data-operational-toast]')).toBeVisible();
  } finally { release(); await other.close(); }
});

