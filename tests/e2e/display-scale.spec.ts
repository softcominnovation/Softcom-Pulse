import { test, expect, type Page } from "@playwright/test";
import { adminFixture } from "../fixtures/admin";
import { signIn } from "../fixtures/infrastructure";

const scaleLabel = "Tamanho dos elementos no telão";
const root = (page: Page) => page.locator(".dashboard-shell");

test("reading scale previews locally, saves with presentation, resets explicitly and preserves drafts on conflicts", async ({ page }) => {
  const state = await adminFixture(page); await signIn(page); await page.goto("/admin/configuracoes");
  await expect(page.getByLabel(scaleLabel)).toHaveValue("110");
  const normalFont = await page.getByRole("heading", { name: "Configurações da visualização" }).evaluate(node => getComputedStyle(node).fontSize);
  await page.getByLabel(scaleLabel).selectOption("125");
  await page.getByRole("button", { name: "Ver prévia", exact: true }).click();
  await expect(page.locator(".dashboard-preview")).toHaveAttribute("data-display-scale", "125");
  await expect(page.locator(".dashboard-preview .asgard-panel")).toBeVisible();
  await page.getByLabel("Visualização da prévia").selectOption("normal");
  await expect(page.locator(".dashboard-preview")).toHaveAttribute("data-display-scale", "100");
  expect(state.writes).toHaveLength(0);
  expect(await page.getByRole("heading", { name: "Configurações da visualização" }).evaluate(node => getComputedStyle(node).fontSize)).toBe(normalFont);
  await page.getByRole("button", { name: "Salvar apresentação", exact: true }).click();
  await expect.poll(() => state.document.displayScalePercent).toBe(125);
  await page.reload(); await expect(page.getByLabel(scaleLabel)).toHaveValue("125");
  await page.getByRole("button", { name: "Restaurar tamanho padrão" }).click();
  await expect(page.getByLabel(scaleLabel)).toHaveValue("110"); expect(state.document.displayScalePercent).toBe(125);
  state.presentationConflict = true;
  await page.getByRole("button", { name: "Salvar apresentação", exact: true }).click();
  await expect(page.locator(".admin-error[role=alert]")).toContainText("outra sessão");
  await expect(page.getByLabel(scaleLabel)).toHaveValue("110"); expect(state.document.displayScalePercent).toBe(125);
});

test("TV and native fullscreen apply one shared scale; exiting, failure and detail navigation restore the normal view", async ({ page }) => {
  const state = await adminFixture(page); state.document.displayScalePercent = 120;
  await page.setViewportSize({ width: 1920, height: 1080 }); await signIn(page);
  await expect(root(page)).toHaveAttribute("data-display-scale", "100");
  await expect(page.locator(".asgard-panel")).toBeVisible();
  const normal = await page.locator(".kpi-label").first().evaluate(node => parseFloat(getComputedStyle(node).fontSize));
  await page.getByRole("button", { name: "Tela cheia", exact: true }).click();
  await expect(root(page)).toHaveAttribute("data-display-scale", "120");
  expect(await page.locator(".kpi-label").first().evaluate(node => parseFloat(getComputedStyle(node).fontSize))).toBeCloseTo(normal * 1.2);
  await page.getByRole("button", { name: "Modo TV", exact: true }).click();
  await expect(root(page)).toHaveAttribute("data-display-scale", "120");
  expect(await page.locator(".kpi-label").first().evaluate(node => parseFloat(getComputedStyle(node).fontSize))).toBeCloseTo(normal * 1.2);
  await page.evaluate(() => document.exitFullscreen());
  await expect(page.getByRole("button", { name: "Tela cheia", exact: true })).toBeVisible();
  await expect(root(page)).toHaveAttribute("data-display-scale", "120");
  await page.getByRole("button", { name: "Sair do modo TV", exact: true }).click();
  await expect(root(page)).toHaveAttribute("data-display-scale", "100");
  await page.evaluate(() => { document.documentElement.requestFullscreen = () => Promise.reject(new Error("denied")); });
  await page.getByRole("button", { name: "Tela cheia", exact: true }).click();
  await expect(page.getByText("Tela cheia indisponível neste navegador.", { exact: false })).toBeVisible();
  await expect(root(page)).toHaveAttribute("data-display-scale", "100");
  await page.getByRole("button", { name: "Modo TV", exact: true }).click();
  await page.getByRole("link", { name: "Ver ASGARD", exact: true }).click();
  await expect(page).toHaveURL(/\/asgard\?/);
  await expect(page.locator("[data-display-scale]")).toHaveCount(0);
  expect(await page.locator(".kpi-label").first().evaluate(node => parseFloat(getComputedStyle(node).fontSize))).toBe(normal);
});

test("an already-open TV receives a new saved scale without stopping presentation or overwriting local TV state", async ({ page }) => {
  const state = await adminFixture(page); await page.clock.install(); await signIn(page);
  await page.getByRole("button", { name: "Modo TV", exact: true }).click();
  await expect(root(page)).toHaveAttribute("data-display-scale", "110");
  state.document.displayScalePercent = 125; state.document.revision++;
  await page.clock.fastForward(61000);
  await expect(root(page)).toHaveAttribute("data-display-scale", "125");
  await expect(page.getByRole("button", { name: "Sair do modo TV", exact: true })).toBeVisible();
});

for (const viewport of [{ width: 390, height: 844 }, { width: 1366, height: 768 }, { width: 1920, height: 1080 }, { width: 3440, height: 1440 }]) {
  test(`all telão scales preserve access and compact columns at ${viewport.width}px`, async ({ page }) => {
    const state = await adminFixture(page); await page.setViewportSize(viewport); await signIn(page);
    for (const value of [100, 110, 120, 125] as const) {
      state.document.displayScalePercent = value;
      await page.reload(); await expect(page.locator(".asgard-panel")).toBeVisible();
      await page.getByRole("button", { name: "Modo TV", exact: true }).click();
      await expect(root(page)).toHaveAttribute("data-display-scale", String(value));
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
      const highlights = await page.locator(".block-highlighted_resources").boundingBox();
      const asgard = await page.locator(".block-asgard_summary").boundingBox();
      const problems = await page.locator(".block-problems").boundingBox();
      expect(asgard!.y).toBeGreaterThanOrEqual(highlights!.y + highlights!.height - 1);
      if (viewport.width >= 1366) {
        expect(asgard!.y).toBeCloseTo(problems!.y, 0);
        expect(asgard!.x + asgard!.width).toBeLessThanOrEqual(problems!.x);
        expect(highlights!.width).toBeGreaterThan(asgard!.width * 1.8);
      }
      const table = page.locator(".vm-table-scroll");
      expect(await table.evaluate(node => node.clientHeight)).toBeGreaterThan(65);
      await table.evaluate(node => { node.scrollTop = node.scrollHeight; });
      await page.getByRole("link", { name: "vm-operacao-15", exact: true }).scrollIntoViewIfNeeded();
      await expect(page.getByRole("link", { name: "vm-operacao-15", exact: true })).toBeInViewport();
      await page.locator(".dashboard-footer").scrollIntoViewIfNeeded();
      await expect(page.locator(".dashboard-footer")).toBeInViewport();
      const footer = await page.locator(".dashboard-footer").boundingBox();
      const lastPanel = await page.locator(".block-problems").boundingBox();
      expect(footer!.y).toBeGreaterThanOrEqual(lastPanel!.y + lastPanel!.height - 1);
      await table.evaluate(node => { node.scrollTop = 0; node.scrollLeft = 0; });
      await page.evaluate(() => window.scrollTo(0, 0));
      if (value === 110 || value === 125) await page.screenshot({ path: `.cache/scale-${viewport.width}-${value}.png`, fullPage: true });
    }
  });
}
