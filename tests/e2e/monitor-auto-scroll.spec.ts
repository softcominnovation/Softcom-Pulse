import { test, expect, type Page } from "@playwright/test";
import { overview, presentation } from "../fixtures/dashboard";
import { effectiveOptions } from "../../lib/config/presentation";

async function monitor(page: Page, { count = 1, idle = false, autoScrollOnLoad = true, reducedMotion = "no-preference" }: { count?: number; idle?: boolean; autoScrollOnLoad?: boolean; reducedMotion?: "reduce" | "no-preference" } = {}) {
  const document = presentation(count, 1);
  document.schemaVersion = 2;
  document.publicMonitorAutoScrollOnLoad = autoScrollOnLoad;
  document.idlePresentation = { enabled: idle, afterMinutes: 1, requestFullscreen: false };
  for (const screen of document.screens) for (const block of screen.blocks) block.options = effectiveOptions({ type: block.type });
  await page.route("**/api/public/settings/presentation", route => route.fulfill({ json: { data: document } }));
  let readings = 0;
  await page.route("**/api/public/dashboard/overview*", route => {
    const result = overview(document, new URL(route.request().url()).searchParams.get("screenId") ?? undefined);
    if (idle) {
      const increment = readings++;
      if (result.data.summary.containersRunning !== null) result.data.summary.containersRunning += increment;
      if (result.data.summary.containersTotal != null) result.data.summary.containersTotal += increment;
    }
    return route.fulfill({ json: result });
  });
  await page.emulateMedia({ reducedMotion });
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto("/monitor?compat=0");
  const region = page.locator(".vm-table-scroll[data-monitor-auto-scroll]").first();
  await expect(region).toBeVisible();
  return region;
}

test("monitor scrolls overflowing panels in both directions, pauses manually and keeps its viewport", async ({ page }) => {
  const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
  const region = await monitor(page);
  await expect.poll(() => region.evaluate(element => element.scrollTop)).toBeGreaterThan(12);
  await page.getByRole("button", { name: "Pausar rolagem automática", exact: true }).click();
  const atPause = await region.evaluate(element => element.scrollTop);
  await page.waitForTimeout(700);
  expect(await region.evaluate(element => element.scrollTop)).toBe(atPause);
  await page.getByRole("button", { name: "Retomar rolagem automática", exact: true }).click();
  await expect.poll(() => region.evaluate(element => element.scrollTop), { timeout: 6000 }).toBeGreaterThan(atPause + 12);
  await region.focus(); await region.press("End");
  await expect.poll(() => region.evaluate(element => element.scrollTop >= element.scrollHeight - element.clientHeight - 1)).toBe(true);
  const bottom = await region.evaluate(element => element.scrollTop);
  await page.waitForTimeout(1000);
  expect(await region.evaluate(element => element.scrollTop)).toBe(bottom);
  await expect.poll(() => region.evaluate(element => element.scrollTop), { timeout: 11000 }).toBeLessThan(bottom - 10);
  const bounds = await page.locator(".public-monitor-stage").boundingBox();
  expect(bounds?.width).toBeCloseTo(1280, 0); expect(bounds?.height).toBeCloseTo(720, 0);
  expect(await page.evaluate(() => ({ x: scrollX, y: scrollY }))).toEqual({ x: 0, y: 0 });
  expect(errors).toEqual([]);
});

test("automatic scrolling survives screen changes without pausing rotation and stops on leaving monitor", async ({ page }) => {
  const region = await monitor(page, { count: 2 });
  await page.getByRole("button", { name: "Alternar telas", exact: true }).click();
  await expect.poll(() => region.evaluate(element => element.scrollTop)).toBeGreaterThan(12);
  await expect(page.getByText("Alternância pausada para leitura", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("combobox", { name: "Escolher tela" })).toHaveValue("00000000-0000-4000-8000-000000000002", { timeout: 10000 });
  await expect(page.getByText("Alternância pausada para leitura", { exact: true })).toHaveCount(0);
  await page.goto("/monitor/servicos");
  await expect(page.locator("[data-monitor-auto-scroll]")).toHaveCount(0);
  await expect(page.getByRole("button", { name: /rolagem automática/ })).toHaveCount(0);
});

test("polling preserves monitor scroll and its automatic events do not postpone inactivity", async ({ page }) => {
  await page.clock.install();
  const region = await monitor(page, { idle: true });
  await page.getByRole("button", { name: "Sair do modo TV", exact: true }).click();
  const running = page.locator(".dashboard-kpi").filter({ has: page.getByRole("heading", { name: "Containers em execução", exact: true }) }).locator(".kpi-value");
  const initialRunning = Number(await running.innerText());
  await page.clock.runFor(3500);
  await page.clock.fastForward(15500);
  const before = await region.evaluate(element => element.scrollTop);
  expect(before).toBeGreaterThan(12);
  const refreshed = page.waitForResponse(response => new URL(response.url()).pathname === "/api/public/dashboard/overview");
  await page.clock.runFor(2000);
  const refreshedRunning = (await (await refreshed).json()).data.summary.containersRunning;
  expect(refreshedRunning).toBeGreaterThan(initialRunning);
  await expect(running).toHaveText(String(refreshedRunning));
  expect(Math.abs(await region.evaluate(element => element.scrollTop) - before)).toBeLessThan(55);
  await page.clock.fastForward(41000);
  await expect(page.getByRole("button", { name: "Sair do modo TV", exact: true })).toBeVisible();
});

for (const autoScrollOnLoad of [true, false]) test(`saved scroll startup ${autoScrollOnLoad} overrides reduced motion and keeps the manual control`, async ({ page }) => {
  await page.clock.install();
  const region = await monitor(page, { autoScrollOnLoad, reducedMotion: "reduce" });
  await expect(page.getByRole("button", { name: autoScrollOnLoad ? "Pausar rolagem automática" : "Retomar rolagem automática", exact: true })).toBeVisible();
  await page.clock.runFor(3500);
  if (autoScrollOnLoad) expect(await region.evaluate(element => element.scrollTop)).toBeGreaterThan(12);
  else expect(await region.evaluate(element => element.scrollTop)).toBe(0);
  if (autoScrollOnLoad) await page.getByRole("button", { name: "Pausar rolagem automática", exact: true }).click();
  await page.getByRole("button", { name: "Sair do modo TV", exact: true }).click();
  await region.focus(); await region.press("End");
  await page.clock.runFor(1000);
  const position = await region.evaluate(element => element.scrollTop);
  expect(position).toBeGreaterThan(12);
  expect(await region.evaluate(element => element.scrollHeight - element.clientHeight - element.scrollTop)).toBeLessThanOrEqual(1);
  await page.clock.runFor(2000);
  expect(await region.evaluate(element => element.scrollTop)).toBe(position);
  await page.getByRole("button", { name: "Retomar rolagem automática", exact: true }).click();
  await expect(page.getByRole("button", { name: "Pausar rolagem automática", exact: true })).toBeVisible();
  let returned = 0;
  for (let elapsed = 0; elapsed < 12000 && returned <= 12; elapsed += 250) {
    await page.clock.runFor(250);
    returned = position - await region.evaluate(element => element.scrollTop);
  }
  expect(returned).toBeGreaterThan(12);
  await expect(page.getByRole("button", { name: "Modo TV", exact: true })).toBeVisible();
  expect(await page.evaluate(() => matchMedia("(prefers-reduced-motion: reduce)").matches)).toBe(true);
  expect(await page.evaluate(() => document.fullscreenElement)).toBeNull();
});
