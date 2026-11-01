import { test, expect, type Page } from "@playwright/test";
import { overview, presentation } from "../fixtures/dashboard";
import { effectiveOptions } from "../../lib/config/presentation";

async function monitor(page: Page, count = 1, idle = false) {
  const document = presentation(count, 1);
  document.schemaVersion = 2;
  document.idlePresentation = { enabled: idle, afterMinutes: 1, requestFullscreen: false };
  for (const screen of document.screens) for (const block of screen.blocks) block.options = effectiveOptions({ type: block.type });
  await page.route("**/api/public/settings/presentation", route => route.fulfill({ json: { data: document } }));
  await page.route("**/api/public/dashboard/overview*", route => route.fulfill({ json: overview(document, new URL(route.request().url()).searchParams.get("screenId") ?? undefined) }));
  await page.emulateMedia({ reducedMotion: "no-preference" });
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
  const region = await monitor(page, 2);
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
  const region = await monitor(page, 1, true);
  await page.getByRole("button", { name: "Sair do modo TV", exact: true }).click();
  await page.clock.runFor(3500);
  await page.clock.fastForward(15500);
  const before = await region.evaluate(element => element.scrollTop);
  expect(before).toBeGreaterThan(12);
  const refreshed = page.waitForResponse(response => new URL(response.url()).pathname === "/api/public/dashboard/overview");
  await page.clock.runFor(2000); await refreshed;
  expect(Math.abs(await region.evaluate(element => element.scrollTop) - before)).toBeLessThan(55);
  await page.clock.fastForward(41000);
  await expect(page.getByRole("button", { name: "Sair do modo TV", exact: true })).toBeVisible();
});

test("reduced motion starts paused and the user can explicitly enable monitor scrolling without TV mode", async ({ page }) => {
  const region = await monitor(page);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect(page.getByRole("button", { name: "Retomar rolagem automática", exact: true })).toBeVisible();
  const position = await region.evaluate(element => element.scrollTop);
  await page.waitForTimeout(700);
  expect(await region.evaluate(element => element.scrollTop)).toBe(position);
  await page.getByRole("button", { name: "Sair do modo TV", exact: true }).click();
  await page.getByRole("button", { name: "Retomar rolagem automática", exact: true }).click();
  await expect.poll(() => region.evaluate(element => element.scrollTop), { timeout: 6000 }).toBeGreaterThan(position + 12);
  expect(await page.evaluate(() => document.fullscreenElement)).toBeNull();
});
