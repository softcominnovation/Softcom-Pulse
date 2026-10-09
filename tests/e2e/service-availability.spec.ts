import { test, expect } from "@playwright/test";
import { adminFixture } from "../fixtures/admin";
import { overview, id } from "../fixtures/dashboard";
import { signIn } from "../fixtures/infrastructure";

for (const viewport of [{ width: 390, height: 844 }, { width: 1366, height: 768 }, { width: 1920, height: 1080 }, { width: 3440, height: 1440 }]) test("compact availability, two rows and bounded alert at " + viewport.width + "px", async ({ page }) => {
  const state = await adminFixture(page);
  state.document.screens[0].blocks[1].options = { sortBy: "configured", sortDirection: "asc", criticalOnly: false, visibleRows: 2 };
  await page.route("**/api/dashboard/overview*", route => {
    const data = overview(state.document);
    Object.assign(data.data.blocks.find(block => block.type === "highlighted_resources")!, { options: state.document.screens[0].blocks[1].options });
    const items = Array.from({ length: viewport.width >= 1920 ? 30 : 12 }, (_, index) => {
      const original = state.service.services[2], container = structuredClone(state.service.containers[0]);
      container.status = index === 3 ? "stopped" : "running"; container.health = "unhealthy";
      container.metrics.cpuUsagePercent!.value = index === 1 ? 95 : 10;
      container.metrics.memoryUsagePercent!.value = 95;
      return { ...original, id: id(9500 + index), linkedVmName: "Softconnect v2", resource: container, metrics: container.metrics, config: { ...original.config, id: id(9500 + index), enabled: true, description: index === 2 ? "Fila de pedidos" : null, displayName: index === 0 ? "Nome de serviço bem longo para verificar o detalhe completo" : "Serviço " + index } };
    });
    data.data.highlightedResources = items; data.data.blocks.find(block => block.type === "highlighted_resources")!.data = items;
    data.presentationStatus = "unavailable";
    return route.fulfill({ json: data });
  });
  await page.setViewportSize(viewport); await signIn(page);
  await expect(page.getByRole("heading", { name: "Disponibilidade de Serviços", exact: true })).toBeVisible();
  const cards = page.locator(".availability-card");
  await expect(cards).toHaveCount(viewport.width >= 1920 ? 30 : 12);
  await expect(cards.nth(0).locator(".availability-description")).toHaveText("Softconnect v2");
  await expect(cards.nth(2).locator(".availability-description")).toHaveText("Fila de pedidos");
  await expect(cards.nth(0).locator(".availability-state")).toHaveText("Disponível");
  await expect(cards.nth(1).locator(".availability-state")).toHaveText("Atenção");
  await expect(cards.nth(3).locator(".availability-state")).toHaveText("Indisponível");
  for (const mode of ["normal", "tv", "fullscreen"]) {
    if (mode === "tv") await page.getByRole("button", { name: "Modo TV", exact: true }).click();
    if (mode === "fullscreen") await page.getByRole("button", { name: "Tela cheia", exact: true }).click();
    expect(await cards.evaluateAll(nodes => nodes.every(node => node.getBoundingClientRect().width <= 230.1 && Math.abs(node.getBoundingClientRect().height - 120) < 0.1 && node.scrollHeight <= node.clientHeight + 1))).toBe(true);
    if (viewport.width >= 1366) {
      const gridWidth = (await page.locator(".availability-grid").boundingBox())!.width;
      const cardWidth = (await cards.nth(0).boundingBox())!.width;
      expect(cardWidth).toBeLessThanOrEqual(230.1);
      expect(gridWidth).toBeGreaterThan(cardWidth + 80);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    if (viewport.width >= 1366) {
      expect((await page.locator(".dashboard-footer").boundingBox())!.y + (await page.locator(".dashboard-footer").boundingBox())!.height).toBeLessThanOrEqual(viewport.height + 1);
      const grid = page.locator(".availability-grid");
      expect(await grid.evaluate(node => node.clientHeight)).toBeGreaterThanOrEqual(viewport.height <= 900 ? 130 : 250);
      const footer = (await page.locator(".dashboard-footer").boundingBox())!;
      for (const type of ["asgard_summary", "problems"]) {
        const panel = (await page.locator(`.block-${type}`).boundingBox())!;
        expect(panel.y + panel.height).toBeLessThanOrEqual(footer.y + 1);
      }
      expect(await page.locator(".vm-table-scroll").evaluate(node => node.clientHeight)).toBeGreaterThanOrEqual(40);
    }
    await page.screenshot({ path: ".cache/availability-" + viewport.width + "-" + mode + ".png", fullPage: viewport.width === 390 });
  }
  if (await page.evaluate(() => !!document.fullscreenElement)) await page.evaluate(() => document.exitFullscreen());
  await page.getByRole("link", { name: "Todos os serviços", exact: true }).click();
  await expect(page).toHaveURL(/\/servicos$/);
});
