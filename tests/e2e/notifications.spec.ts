import { test, expect } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { adminFixture } from "../fixtures/admin";
import { signIn } from "../fixtures/infrastructure";
import { notificationFixture, notificationFixtureState, addNotification } from "../fixtures/notifications";
import { overview, presentation } from "../fixtures/dashboard";
import { enterNativeFullscreen, exitNativeFullscreen } from "../fixtures/fullscreen";

test("shared read state updates isolated browsers while startup history stays silent", async ({ page, browser, baseURL }) => {
  test.setTimeout(60000);
  const state = notificationFixtureState(); addNotification(state);
  await adminFixture(page); await notificationFixture(page, state); await signIn(page);
  await expect(page.getByRole("button", { name: /^Notificações: 1 não lidas/ })).toBeVisible();
  await expect(page.locator('[data-operational-toast]')).toHaveCount(0);
  const isolated = await browser.newContext({ baseURL });
  try {
  const other = await isolated.newPage(); await adminFixture(other); await notificationFixture(other, state); await signIn(other);
  await other.evaluate(() => localStorage.setItem("kobra-sound-muted", "1"));
  expect(await page.evaluate(() => localStorage.getItem("kobra-sound-muted"))).not.toBe("1");
  await expect(other.getByRole("button", { name: /^Notificações: 1 não lidas/ })).toBeVisible();
  await other.getByRole("button", { name: /^Notificações:/ }).click();
  await expect(other.getByRole("dialog", { name: "Notificações", exact: true })).toContainText("Crítica");
  await other.getByRole("button", { name: "Marcar como lida", exact: true }).click();
  await expect(other.getByRole("dialog", { name: "Notificações", exact: true })).toContainText("0 não lidas");
  await other.keyboard.press("Escape");
  await expect(other.getByRole("button", { name: /^Notificações: 0 não lidas/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /^Notificações: 0 não lidas/ })).toBeVisible({ timeout: 15000 });
  expect(state.writes).toBe(1); await expect(page.locator('[data-operational-toast]')).toHaveCount(0);
  } finally { await isolated.close(); }
});

test("fresh events display once and offline polling keeps known counts without alarm toasts", async ({ page }) => {
  test.setTimeout(45000);
  const state = await notificationFixture(page); await adminFixture(page); await signIn(page);
  // Wait until the baseline is committed in the client before injecting a new event.
  await expect(page.getByRole("button", { name: "Notificações: 0 não lidas, 0 incidentes atuais", exact: true })).toBeVisible();
  addNotification(state);
  await expect(page.locator('[data-operational-toast]')).toContainText("Storage de operações", { timeout: 16000 });
  await expect(page.getByRole("button", { name: /^Notificações: 1 não lidas/ })).toBeVisible();
  state.fail = true;
  await expect(page.getByRole("button", { name: /Notificações: 1 não lidas.*sincronização indisponível/ })).toBeVisible({ timeout: 15000 });
  await expect(page.locator('[data-operational-toast]')).toHaveCount(0);
});

test("saving a service exception preserves the unsaved general draft and conflict keeps edits", async ({ page }) => {
  const admin = await adminFixture(page), state = await notificationFixture(page); await signIn(page); await page.goto("/admin/configuracoes");
  const section = page.locator("section").filter({ has: page.getByRole("heading", { name: "Notificações de serviços", exact: true }) });
  await section.getByLabel("Duração do aviso (segundos)").fill("12");
  await section.getByLabel("Exceção por serviço").selectOption({ label: "Storage de operações · crítico" });
  await section.getByLabel("Som deste serviço", { exact: true }).selectOption("off");
  await section.getByRole("button", { name: "Salvar notificações deste serviço" }).click();
  await expect.poll(() => state.policy.revision).toBe(2);
  await expect(section.getByLabel("Duração do aviso (segundos)")).toHaveValue("12");
  expect(state.policy.toastLifetimeMs).toBe(8000); expect(admin.writes).toHaveLength(0);
  state.conflict = true; await section.getByRole("button", { name: "Salvar política geral" }).click();
  await expect(section.locator('[role="alert"]')).toBeVisible(); await expect(section.getByLabel("Duração do aviso (segundos)")).toHaveValue("12");
  state.conflict = false; await section.getByRole("button", { name: "Salvar política geral" }).click();
  await expect.poll(() => state.policy.toastLifetimeMs).toBe(12000);
});

for (const width of [360, 1440]) test(`notification center overlays the dashboard without moving its panels at ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: 900 });
  await adminFixture(page); await notificationFixture(page); await signIn(page);
  await expect(page.getByRole("button", { name: "Notificações: 0 não lidas, 0 incidentes atuais", exact: true })).toBeVisible();
  const panel = page.locator(".dashboard-panel").first(); await expect(panel).toBeVisible(); const before = await panel.boundingBox();
  await page.getByRole("button", { name: /^Notificações:/ }).click();
  await expect(page.getByRole("dialog", { name: "Notificações", exact: true })).toBeVisible();
  const after = await panel.boundingBox(); expect(after?.y).toBe(before?.y); expect(after?.height).toBe(before?.height);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await mkdir(".cache/screenshots", { recursive: true }); await page.screenshot({ path: `.cache/screenshots/notifications-${width}.png`, fullPage: false });
  await page.keyboard.press("Escape"); await expect(page.getByRole("dialog", { name: "Notificações", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /^Notificações:/ })).toBeFocused();
});

test("two active tabs show their own toast but coordinate one operational sound", async ({ page, context }) => {
  test.setTimeout(45000);
  await context.addInitScript(() => {
    const sounds: string[] = [];
    Object.defineProperty(window, "operationalSounds", { value: sounds });
    window.addEventListener("kobra:toast", event => {
      const detail = (event as CustomEvent<{ operational?: boolean; sound?: string | false }>).detail;
      if (detail.operational && detail.sound) sounds.push(detail.sound);
    });
  });
  const state = notificationFixtureState();
  await adminFixture(page); await notificationFixture(page, state); await signIn(page);
  const other = await context.newPage(); await adminFixture(other); await notificationFixture(other, state); await other.goto("/");
  for (const tab of [page, other]) {
    await expect(tab.getByRole("button", { name: "Notificações: 0 não lidas, 0 incidentes atuais", exact: true })).toBeVisible();
    await tab.getByRole("button", { name: /^Notificações:/ }).click(); await tab.keyboard.press("Escape");
  }
  addNotification(state);
  for (const tab of [page, other]) await expect(tab.locator('[data-operational-toast]')).toContainText("Storage de operações", { timeout: 16000 });
  const sounds = await Promise.all([page, other].map(tab => tab.evaluate(() => (window as typeof window & { operationalSounds: string[] }).operationalSounds)));
  expect(sounds.flat()).toEqual(["error"]);
  await other.close();
});

test("authenticated public notification center remains read-only and uses public routes", async ({ page }) => {
  const state = notificationFixtureState(); addNotification(state);
  await adminFixture(page); await notificationFixture(page, state); await signIn(page);
  const document = presentation();
  await page.route("**/api/public/settings/presentation", route => route.fulfill({ json: { data: document } }));
  await page.route("**/api/public/dashboard/overview*", route => route.fulfill({ json: overview(document) }));
  await page.goto("/monitor");
  const requests: string[] = [];
  page.on("request", request => { if (request.url().includes("/notifications")) requests.push(`${request.method()} ${new URL(request.url()).pathname}`); });
  await page.getByRole("button", { name: /^Notificações: 1 não lidas/ }).click();
  const dialog = page.getByRole("dialog", { name: "Notificações", exact: true });
  await expect(dialog.getByRole("heading", { name: "Storage de operações" })).toBeVisible();
  await expect(dialog.getByRole("button", { name: /Marcar/ })).toHaveCount(0);
  expect(state.writes).toBe(0);
  expect(requests.length).toBeGreaterThan(0); expect(requests, JSON.stringify(requests)).toEqual(expect.arrayContaining(["GET /api/public/monitoring/notifications"]));
  expect(requests.every(value => value.startsWith("GET /api/public/monitoring/notifications"))).toBe(true);
});

test("operational toast and center stay visible in native fullscreen TV without resizing panels", async ({ page }) => {
  test.setTimeout(45000);
  await page.setViewportSize({ width: 1366, height: 768 });
  const admin = await adminFixture(page), state = await notificationFixture(page);
  admin.document.displayScalePercent = 125;
  await signIn(page);
  await expect(page.getByRole("button", { name: "Notificações: 0 não lidas, 0 incidentes atuais", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Modo TV", exact: true }).click(); await enterNativeFullscreen(page);
  try {
    const panel = page.locator(".dashboard-panel").first();
    const before = await panel.boundingBox(); expect(before).not.toBeNull();
    addNotification(state);
    const toast = page.locator('[data-operational-toast]'); await expect(toast).toBeVisible({ timeout: 16000 });
    const box = await toast.boundingBox(), viewport = await page.evaluate(() => ({ width: innerWidth, height: innerHeight }));
    expect(box!.x).toBeGreaterThanOrEqual(0); expect(box!.y).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(viewport.width); expect(box!.y + box!.height).toBeLessThanOrEqual(viewport.height);
    await toast.getByRole("button", { name: "Ver central" }).click();
    await expect(page.getByRole("dialog", { name: "Notificações", exact: true })).toBeVisible();
    const after = await panel.boundingBox(); expect(after?.height).toBe(before?.height); expect(after?.y).toBe(before?.y);
    await page.keyboard.press("Escape");
  } finally { await exitNativeFullscreen(page); }
});
