import { expect, type Page } from "@playwright/test";

export async function enterNativeFullscreen(page: Page) {
  await page.bringToFront();
  await page.getByRole("button", { name: "Tela cheia", exact: true }).click();
  await expect.poll(() => page.evaluate(() => document.fullscreenElement === document.documentElement)).toBe(true);
  await expect(page.getByRole("button", { name: "Sair da tela cheia", exact: true })).toBeVisible();
}

export async function exitNativeFullscreen(page: Page) {
  await page.bringToFront();
  await page.evaluate(async () => {
    if (!document.fullscreenElement) return;
    try { await document.exitFullscreen(); }
    // Chromium may already have left fullscreen between the guard and request.
    catch (error) { if (document.fullscreenElement) throw error; }
  });
  await expect.poll(() => page.evaluate(() => document.fullscreenElement === null)).toBe(true);
  await expect(page.getByRole("button", { name: "Tela cheia", exact: true })).toBeVisible();
}
