import { test, expect, type Page } from "@playwright/test";
import { storageUiFixture } from "../fixtures/storage";
import { signIn } from "../fixtures/infrastructure";
import { id, overview } from "../fixtures/dashboard";
import { effectiveOptions } from "../../lib/config/presentation";

async function secondScreenFixture(page: Page, layout: "overview" | "wall") {
  const state = await storageUiFixture(page), first = state.admin.document.screens[0];
  first.layout = layout;
  const second = { ...structuredClone(first), id: id(9300), name: "Storage e ASGARD", layout,
    blocks: first.blocks.filter(block => ["summary", "highlighted_resources", "asgard_summary"].includes(block.type)).map((block, index) => ({ ...structuredClone(block), id: id(9301 + index) })),
  };
  second.blocks.push({ id: id(9304), type: "storage_summary", width: "wide", enabled: true, options: { storageConfigId: state.configs[0].id, visibleRows: 3 } });
  state.admin.document.screens.push(second);
  const source = state.items[0];
  state.items = [source, ...Array.from({ length: 2 }, (_, index) => ({ ...structuredClone(source), configId: id(9400 + index), displayName: `Serviço ${index + 2}`, storageKey: `storage-${String(index + 2).padStart(32, "0")}` }))];
  await page.route("**/api/dashboard/overview*", route => {
    const result = overview(state.admin.document, new URL(route.request().url()).searchParams.get("screenId") ?? undefined);
    const screen = state.admin.document.screens.find(screen => screen.id === result.data.screenId)!;
    for (const block of result.data.blocks) {
      block.options = screen.blocks.find(candidate => candidate.id === block.blockId)?.options;
      if (block.type === "storage_summary") block.data = { target: source };
      if (block.type === "highlighted_resources") block.data = { cards: state.items.map(item => ({ kind: "storage" as const, item })) };
    }
    return route.fulfill({ json: result });
  });
  return { state, first, second };
}

for (const width of [390, 1366, 1920, 3440]) for (const layout of ["overview", "wall"] as const) {
  test(`Storage second screen ${layout} ${width} keeps standalone availability sized to its cards`, async ({ page }) => {
    const { state, first, second } = await secondScreenFixture(page, layout);
    await page.setViewportSize({ width, height: width === 390 ? 844 : width === 1366 ? 768 : width === 1920 ? 1080 : 1440 });
    await signIn(page);
    for (const scale of [100, 125] as const) for (const visibleRows of [1, 2]) {
      state.admin.document.displayScalePercent = scale; state.admin.document.revision++;
      for (const screen of [first, second]) screen.blocks.find(block => block.type === "highlighted_resources")!.options = { ...effectiveOptions({ type: "highlighted_resources" }), visibleRows };
      await page.reload();
      await page.getByRole("button", { name: "Modo TV", exact: true }).click();
      await page.getByLabel("Escolher tela").selectOption(first.id);
      await expect(page.locator(".dashboard-shell")).toHaveAttribute("data-display-scale", String(scale));
      const panel = page.locator(".availability-panel");
      await expect(panel).toHaveAttribute("data-service-rows", String(visibleRows));
      await expect(panel.locator(".availability-card")).toHaveCount(3);
      const originalHeight = (await panel.boundingBox())!.height;
      await page.getByLabel("Escolher tela").selectOption(second.id);
      await expect(page.locator(".storage-panel")).toBeVisible();
      await expect(panel).toHaveAttribute("data-service-rows", String(visibleRows));
      await expect.poll(async () => (await panel.boundingBox())!.height).toBeCloseTo(originalHeight, 0);
      const geometry = await panel.evaluate(node => ({ gap: node.getBoundingClientRect().bottom - node.querySelector(".panel-foot")!.getBoundingClientRect().bottom }));
      expect(geometry.gap).toBeLessThanOrEqual(2);
      for (const card of await panel.locator(".availability-card").all()) expect((await card.boundingBox())!.height).toBe(120);
      const storage = page.locator(".storage-panel");
      await storage.getByRole("heading", { name: "Archive One" }).scrollIntoViewIfNeeded();
      await expect(storage.getByRole("heading", { name: "Archive One" })).toBeInViewport();
      if (width < 1201) await page.locator(".dashboard-footer").scrollIntoViewIfNeeded();
      await expect(page.locator(".dashboard-footer")).toBeInViewport();
    }
    await page.screenshot({ path: `.cache/storage-validation/availability-content-${layout}-${width}.png` });
    expect(state.admin.writes).toHaveLength(0);
  });
}

test("Storage preview keeps a full-width availability row at its content height", async ({ page }) => {
  const { state } = await secondScreenFixture(page, "overview");
  await page.setViewportSize({ width: 1920, height: 1080 }); await signIn(page); await page.goto("/admin/configuracoes");
  await page.getByRole("button", { name: "Ver prévia", exact: true }).nth(1).click();
  const preview = page.locator(".dashboard-preview");
  await expect(preview.locator(".storage-panel")).toBeVisible();
  const panel = preview.locator(".availability-panel");
  await expect.poll(() => panel.evaluate(node => node.getBoundingClientRect().bottom - node.querySelector(".panel-foot")!.getBoundingClientRect().bottom)).toBeLessThanOrEqual(2);
  expect(state.admin.writes).toHaveLength(0);
});

test("Storage recomputes overflow when availability gains and loses a visible card row", async ({ page }) => {
  const { state, second } = await secondScreenFixture(page, "overview");
  state.admin.document.displayScalePercent = 100;
  second.blocks.find(block => block.type === "highlighted_resources")!.options = { ...effectiveOptions({ type: "highlighted_resources" }), visibleRows: 2 };
  await page.setViewportSize({ width: 1920, height: 800 }); await signIn(page);
  await page.getByRole("button", { name: "Modo TV", exact: true }).click();
  await page.getByLabel("Escolher tela").selectOption(second.id);
  const composition = page.locator("[data-storage-layout]"), panel = page.locator(".availability-panel");
  await expect(panel.locator(".availability-card")).toHaveCount(3);
  await expect(composition).toHaveAttribute("data-overflow", "false");
  const initialHeight = (await panel.boundingBox())!.height, originalItems = state.items;
  state.items = Array.from({ length: 24 }, (_, index) => ({ ...structuredClone(originalItems[0]), configId: id(9500 + index), storageKey: `storage-${String(index + 100).padStart(32, "0")}`, displayName: `Serviço ${index + 1}` }));
  await page.evaluate(() => window.dispatchEvent(new Event("pulse:preferences-changed")));
  await expect(panel.locator(".availability-card")).toHaveCount(24);
  await expect.poll(async () => (await panel.boundingBox())!.height).toBeGreaterThan(initialHeight + 100);
  await expect(composition).toHaveAttribute("data-overflow", "true");
  state.items = originalItems;
  await page.evaluate(() => window.dispatchEvent(new Event("pulse:preferences-changed")));
  await expect(panel.locator(".availability-card")).toHaveCount(3);
  await expect.poll(async () => (await panel.boundingBox())!.height).toBeCloseTo(initialHeight, 0);
  await expect(composition).toHaveAttribute("data-overflow", "false");
  await expect(page.locator(".dashboard-footer")).toBeInViewport();
});
