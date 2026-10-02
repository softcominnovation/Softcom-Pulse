import { test, expect } from "@playwright/test";

for (const width of [320, 360, 390, 768, 1024, 1440]) {
  test("presence at " + width + "px uses Pulse typography and colors", async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "Softcom Pulse" })).toBeVisible();
    await expect(page.locator("html")).toHaveAttribute("lang", "pt-BR");
    await expect(page.locator("html")).toHaveClass("dark");
    await expect(page.locator("body")).toHaveCSS("background-color", "rgb(12, 17, 22)");
    expect(await page.locator("body").evaluate(node => getComputedStyle(node).fontFamily)).toContain("Segoe UI");
    expect(await page.locator("body").evaluate(node => getComputedStyle(node).fontFamily)).not.toContain("Inter");
    await expect(page.locator("link[rel=icon]")).toHaveAttribute("href", "/logo.ico");
    expect((await page.request.get("/logo.ico")).ok()).toBe(true);
    expect(await page.locator("img").evaluate((node: HTMLImageElement) => node.complete && node.naturalWidth > 0)).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await expect(page.getByRole("button", { name: "Verificar conexão" })).toBeInViewport();
  });
}
test("health has no private values and the UI calls its BFF", async ({ page }) => {
  await page.goto("/");
  const response = await page.request.get("/api/health");
  expect(response.status()).toBe(200);
  expect(await response.json()).toEqual({ status: "ok", checks: { database: "up", cache: "up" } });
  expect(response.headers()["cache-control"]).toContain("no-store");
  await page.getByRole("button", { name: "Verificar conexão" }).click();
  await expect(page.getByRole("status")).toHaveText("Conexão disponível.");
  await page.route("**/api/health", route => route.fulfill({ status: 503, json: { status: "unavailable", checks: { database: "down", cache: "up" } } }));
  await page.getByRole("button", { name: "Verificar conexão" }).click();
  await expect(page.getByRole("status")).toContainText("temporariamente indisponível");
});
test("keyboard and 200% equivalent reflow remain available", async ({ page }) => {
  await page.setViewportSize({ width: 640, height: 450 });
  await page.goto("/");
  await page.keyboard.press("Tab");
  const button = page.getByRole("button", { name: "Verificar conexão" });
  await expect(button).toBeFocused();
  await expect(button).toHaveCSS("outline-style", "solid");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole("link", { name: "Softcom Tecnologia" }).scrollIntoViewIfNeeded();
  await expect(page.getByRole("link", { name: "Softcom Tecnologia" })).toBeInViewport();
});
