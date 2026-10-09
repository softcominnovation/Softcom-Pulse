import { test, expect, type Page } from "@playwright/test";
import { adminFixture } from "../fixtures/admin";
import { signIn } from "../fixtures/infrastructure";
import { id } from "../fixtures/dashboard";

const enabledLabel = "Entrar no modo TV após inatividade";
const minutesLabel = "Tempo sem interação (minutos)";
const fullscreenLabel = "Tentar tela cheia ao entrar automaticamente";
const tv = (page: Page, active = false) => page.getByRole("button", { name: active ? "Sair do modo TV" : "Modo TV", exact: true });
async function ready(page: Page, requestFullscreen = false) {
  const state = await adminFixture(page);
  state.document.idlePresentation = { enabled: true, afterMinutes: 1, requestFullscreen };
  await page.clock.install(); await signIn(page);
  await expect(page.locator(".asgard-panel")).toBeVisible();
  return state;
}
async function hidden(page: Page, value: boolean) {
  await page.evaluate(value => { Object.defineProperty(document, "hidden", { configurable: true, value }); document.dispatchEvent(new Event("visibilitychange")); }, value);
}

for (const width of [390, 1366]) {
  test(`idle settings save, reload, cancel and preserve conflicting drafts at ${width}px`, async ({ page }) => {
    const state = await adminFixture(page); await page.setViewportSize({ width, height: 900 }); await signIn(page); await page.goto("/admin/configuracoes");
    await expect(page.getByLabel(enabledLabel, { exact: true })).not.toBeChecked();
    await expect(page.getByLabel(minutesLabel, { exact: true })).toHaveValue("5");
    await expect(page.getByLabel(fullscreenLabel, { exact: true })).toBeChecked();
    await page.getByLabel(enabledLabel, { exact: true }).check();
    await page.getByLabel(minutesLabel, { exact: true }).fill("0");
    await expect(page.getByText("o tempo sem interação deve ser um inteiro entre 1 e 120 minutos.", { exact: false })).toBeVisible();
    expect(state.writes).toHaveLength(0);
    await page.getByLabel(minutesLabel, { exact: true }).fill("10");
    await page.getByLabel(fullscreenLabel, { exact: true }).uncheck();
    await page.getByRole("button", { name: "Cancelar alterações" }).click();
    await expect(page.getByLabel(enabledLabel, { exact: true })).not.toBeChecked();
    await page.getByLabel(enabledLabel, { exact: true }).check();
    await page.getByLabel(minutesLabel, { exact: true }).fill("10");
    await page.getByLabel(fullscreenLabel, { exact: true }).uncheck();
    await page.getByRole("button", { name: "Salvar apresentação", exact: true }).click();
    await expect.poll(() => state.document.idlePresentation).toEqual({ enabled: true, afterMinutes: 10, requestFullscreen: false });
    await page.reload(); await expect(page.getByLabel(minutesLabel, { exact: true })).toHaveValue("10");
    state.presentationConflict = true;
    await page.getByLabel(minutesLabel, { exact: true }).fill("7");
    await page.getByRole("button", { name: "Salvar apresentação", exact: true }).click();
    await expect(page.locator(".admin-error[role=alert]")).toContainText("outra sessão");
    await expect(page.getByLabel(minutesLabel, { exact: true })).toHaveValue("7");
    expect(state.document.idlePresentation.afterMinutes).toBe(10);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    await page.getByRole("heading", { name: "Leitura no telão" }).scrollIntoViewIfNeeded();
    await page.screenshot({ path: `.cache/idle-settings-${width}.png` });
  });
}

test("disabled by default; only genuine dashboard inactivity activates TV despite polling", async ({ page }) => {
  const state = await adminFixture(page); await page.clock.install(); await signIn(page);
  await expect(page.locator(".asgard-panel")).toBeVisible();
  await page.clock.fastForward(600000); await expect(tv(page)).toBeVisible();
  state.document.idlePresentation = { enabled: true, afterMinutes: 2, requestFullscreen: false }; state.document.revision++;
  await page.clock.fastForward(61000);
  await expect.poll(() => page.locator(".dashboard-blocks").getAttribute("aria-busy")).toBe("false");
  await page.mouse.move(10, 10);
  await page.clock.fastForward(65000); await expect(tv(page)).toBeVisible();
  await page.clock.fastForward(56000); await expect(tv(page, true)).toBeVisible();
  await expect(page.locator(".dashboard-shell")).toHaveAttribute("data-display-scale", "110");
  expect(await page.evaluate(() => !!document.fullscreenElement)).toBe(false);
});

test("mouse, keyboard, touch, wheel, focus and scrolling restart the full idle interval", async ({ page }) => {
  await ready(page);
  for (const event of ["pointermove", "pointerdown", "keydown", "touchstart", "touchmove", "wheel", "scroll", "focusin"]) {
    await page.clock.fastForward(45000); await expect(tv(page)).toBeVisible();
    await page.locator(".dashboard").dispatchEvent(event, event === "keydown" ? { key: "Shift" } : {});
  }
  await page.clock.fastForward(59000); await expect(tv(page)).toBeVisible();
  await page.clock.fastForward(2000); await expect(tv(page, true)).toBeVisible();
  await page.mouse.move(50, 50); await expect(tv(page, true)).toBeVisible();
  await tv(page, true).click();
  await page.clock.fastForward(59000); await expect(tv(page)).toBeVisible();
  await page.clock.fastForward(2000); await expect(tv(page, true)).toBeVisible();
});

test("hidden tabs and open dialogs suspend inactivity and resume with a full interval", async ({ page }) => {
  await ready(page);
  await page.clock.fastForward(45000); await hidden(page, true);
  await page.clock.fastForward(180000); await expect(tv(page)).toBeVisible();
  await hidden(page, false);
  await page.clock.fastForward(45000); await expect(tv(page)).toBeVisible();
  await page.evaluate(() => { const dialog = document.createElement("dialog"); dialog.id = "idle-test-dialog"; dialog.textContent = "Detalhe aberto"; document.body.append(dialog); dialog.show(); });
  await page.clock.fastForward(180000); await expect(tv(page)).toBeVisible();
  await page.evaluate(() => document.getElementById("idle-test-dialog")!.remove());
  await page.clock.fastForward(59000); await expect(tv(page)).toBeVisible();
  await page.clock.fastForward(2000); await expect(tv(page, true)).toBeVisible();
});

test("blocked fullscreen stays truthful, prompts once and enters native fullscreen with an explicit click", async ({ page }) => {
  await ready(page, true);
  await page.evaluate(() => {
    const original = document.documentElement.requestFullscreen.bind(document.documentElement);
    document.documentElement.dataset.fullscreenAttempts = "0";
    document.documentElement.requestFullscreen = () => {
      const count = Number(document.documentElement.dataset.fullscreenAttempts) + 1;
      document.documentElement.dataset.fullscreenAttempts = String(count);
      return count === 1 ? Promise.reject(new Error("activation required")) : original();
    };
  });
  await page.clock.fastForward(61000); await expect(tv(page, true)).toBeVisible();
  const action = page.getByRole("button", { name: "Entrar em tela cheia", exact: true });
  await expect(action).toBeVisible();
  await expect(page.getByRole("button", { name: "Tela cheia", exact: true })).toHaveAttribute("aria-pressed", "false");
  expect(await page.evaluate(() => !!document.fullscreenElement)).toBe(false);
  await page.clock.fastForward(600000); await expect(action).toHaveCount(1);
  await expect(page.locator("html")).toHaveAttribute("data-fullscreen-attempts", "1");
  await page.screenshot({ path: ".cache/idle-fullscreen-prompt.png" });
  await action.click();
  await expect(page.getByRole("button", { name: "Sair da tela cheia", exact: true })).toBeVisible();
  expect(await page.evaluate(() => !!document.fullscreenElement)).toBe(true);
  await page.evaluate(() => document.exitFullscreen());
  await page.waitForFunction(() => !document.fullscreenElement);
  await page.clock.fastForward(61000);
  await expect(page.locator("html")).toHaveAttribute("data-fullscreen-attempts", "3");
});

test("successful automatic fullscreen uses native state and clears timers and prompts on navigation", async ({ page }) => {
  await ready(page, true);
  await page.evaluate(() => {
    document.documentElement.requestFullscreen = async () => {
      Object.defineProperty(document, "fullscreenElement", { configurable: true, value: document.documentElement });
      document.dispatchEvent(new Event("fullscreenchange"));
    };
    document.exitFullscreen = async () => {
      Object.defineProperty(document, "fullscreenElement", { configurable: true, value: null });
      document.dispatchEvent(new Event("fullscreenchange"));
    };
  });
  await page.clock.fastForward(61000);
  await expect(page.getByRole("button", { name: "Sair da tela cheia", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Entrar em tela cheia", exact: true })).toHaveCount(0);
  await page.getByRole("link", { name: "Ver ASGARD", exact: true }).click();
  await expect(page).toHaveURL(/\/asgard\?/);
  await page.clock.fastForward(600000);
  expect(await page.evaluate(() => !!document.fullscreenElement)).toBe(false);
  await expect(page.locator(".tv-mode")).toHaveCount(0);
});

test("disabling the shared setting cancels a pending deadline without affecting other modes", async ({ page }) => {
  const state = await ready(page); state.document.idlePresentation.afterMinutes = 3; state.document.revision++;
  await page.clock.fastForward(61000); await expect(tv(page, true)).toBeVisible();
  await tv(page, true).click();
  state.document.idlePresentation.enabled = false; state.document.revision++;
  await page.clock.fastForward(61000); await expect(tv(page)).toBeVisible();
  await page.clock.fastForward(600000); await expect(tv(page)).toBeVisible();
  await tv(page).click(); await page.clock.fastForward(600000); await expect(tv(page, true)).toBeVisible();
});

test("slide playback keeps rotating while its background changes do not postpone inactivity", async ({ page }) => {
  const state = await adminFixture(page);
  const second = structuredClone(state.document.screens[0]); second.id = id(6500); second.name = "Operação";
  second.blocks.forEach((block, index) => { block.id = id(6600 + index); });
  state.document.screens.push(second);
  state.document.rotation = { autoStart: true, intervalSeconds: 20 };
  state.document.idlePresentation = { enabled: true, afterMinutes: 1, requestFullscreen: false };
  await page.clock.install(); await signIn(page); await expect(page.locator(".asgard-panel")).toBeVisible();
  await page.clock.fastForward(21000); await expect(page.getByLabel("Escolher tela")).toHaveValue(second.id);
  await page.clock.fastForward(41000); await expect(tv(page, true)).toBeVisible();
  await expect(page.getByRole("button", { name: "Parar alternância", exact: true })).toBeVisible();
});
