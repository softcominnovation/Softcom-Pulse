import { test, expect } from "@playwright/test";
import { storageUiFixture } from "../fixtures/storage";
import { slotUiFixture } from "../fixtures/overview-slots";
import { storageScrollGeometry, storageScrollSurface } from "../fixtures/storage-scroll.mjs";
import { storageViewportFixture } from "../fixtures/storage-viewport.mjs";
import { signIn } from "../fixtures/infrastructure";

test("monitor keeps the bottom Storage row inside the viewport without a composition scrollbar", async ({ page }) => {
  test.setTimeout(90000);
  const { state, model, storage } = await slotUiFixture(page);
  storageViewportFixture(model);
  storage.items[0].description = "Storage";
  storage.items[0].selectedInterface = storage.items[0].interfaces[0];
  for (const [width, height, zoom] of [[1920, 920, 80], [1600, 800, 70], [1920, 1080, 100], [1920, 920, 80]]) {
    state.document.publicMonitorZoomPercent = zoom;
    await page.setViewportSize({ width, height }); await page.goto('/monitor?compat=0');
    const composition = page.locator('.slot-composition');
    await composition.waitFor();
    await expect.poll(() => composition.evaluate(node => {
      const bounds = node.getBoundingClientRect();
      return node.scrollHeight <= node.clientHeight + 1 && [...node.querySelectorAll('.slot-composition-row')].every(row => row.getBoundingClientRect().bottom <= bounds.bottom + 1);
    }), { message: `${width}x${height} at ${zoom}%` }).toBe(true);
    await expect(page.locator('.block-storage_summary .storage-panel')).toBeInViewport({ ratio: 1 });
    await expect(page.locator('.block-asgard_summary .dashboard-panel')).toBeInViewport({ ratio: 1 });
    const grid = page.locator('.availability-grid');
    await expect(grid.locator('.availability-card')).toHaveCount(8);
    expect(await grid.evaluate(node => node.scrollHeight - node.clientHeight)).toBeLessThanOrEqual(1);
    await expect.poll(() => page.locator('.block-storage_summary .storage-panel').evaluate(storageScrollGeometry)).toEqual({ singleScroll: true, contentFits: true, noPageOverflow: true });
  }
  expect(state.writes).toHaveLength(0);
});

test("Storage display selection saves independently, survives reopening and shows only selected table rows", async ({ page }) => {
  const state = await storageUiFixture(page), item = state.items[0], config = state.configs[0];
  config.diskWarningPercent = 70; config.filesystemKeys = item.capacity.filesystemKeys;
  const capacity = structuredClone(item.capacity);
  await signIn(page); await page.goto("/servicos#storages");
  const panel = page.locator("#storages .storage-panel"), editor = page.getByRole("dialog", { name: "Configuração de Storage", exact: true });
  await expect(panel.locator("tbody tr")).toHaveCount(10);
  await panel.getByRole("button", { name: /Configurar Storage/ }).click();
  const group = editor.getByRole("group", { name: "Volumes visíveis no painel", exact: true });
  await group.getByLabel("Exibir todos os volumes descobertos").uncheck();
  for (let index = 1; index < 10; index++) await group.getByLabel(`/data/volume-${index} · Volume ${index + 1} no /monitor`, { exact: true }).uncheck();
  await editor.getByRole("button", { name: "Salvar Storage", exact: true }).click();
  await expect(editor).toHaveCount(0); await expect(panel.locator("tbody tr")).toHaveCount(1);
  expect(state.configs[0].visibleFilesystemKeys).toEqual([item.volumes[0].key]);
  expect(state.configs[0].filesystemKeys).toEqual(capacity.filesystemKeys);
  expect(state.configs[0].diskWarningPercent).toBe(70); expect(item.capacity).toEqual(capacity);
  await page.reload(); await expect(panel.locator("tbody tr")).toHaveCount(1);
  await panel.getByRole("button", { name: /Configurar Storage/ }).click();
  await expect(group.getByLabel("/ · Volume 1 no /monitor", { exact: true })).toBeChecked();
  await group.getByLabel("/ · Volume 1 no /monitor", { exact: true }).uncheck();
  await editor.getByRole("button", { name: "Salvar Storage", exact: true }).click();
  await expect(editor.getByRole("alert")).toContainText("Selecione ao menos um volume"); expect(state.writes).toHaveLength(1);
  await group.getByLabel("Exibir todos os volumes descobertos").check();
  await editor.getByRole("button", { name: "Salvar Storage", exact: true }).click();
  await expect(panel.locator("tbody tr")).toHaveCount(10); expect(state.configs[0].visibleFilesystemKeys).toBeNull();
});

for (const route of ["/", "/monitor?compat=0"]) for (const stacked of [false, true]) test(`Storage keeps one internal scroll and stable panels across zoom/font scales: ${route} stacked=${stacked}`, async ({ page }) => {
  test.setTimeout(120000);
  const { state, screen, find, storage } = await slotUiFixture(page);
  storage.items[0].selectedInterface = storage.items[0].interfaces[0];
  if (!stacked) screen.overviewGrid = "default";
  if (route === "/") await signIn(page);
  let baseline: { id: string | null; height: number; width: number }[] = [];
  for (const zoom of [70, 100, 125]) for (const font of [100, 160]) {
    state.document.dashboardZoomPercent = zoom; state.document.publicMonitorZoomPercent = zoom;
    find("storage_summary").monitorFontScalePercent = font;
    await page.setViewportSize({ width: zoom === 125 ? 1366 : 1920, height: zoom === 125 ? 768 : 1080 });
    await page.goto(route);
    if (route !== "/") await expect(page.locator('.public-monitor-frame')).toHaveAttribute('data-public-monitor-zoom', String(zoom));
    const panel = page.locator('.dashboard-block .storage-panel');
    await expect(panel).toBeVisible({ timeout: 15000 });
    await expect(panel.locator("tbody tr")).toHaveCount(10);
    await expect.poll(() => panel.evaluate(storageScrollGeometry), { message: `${route}, stacked=${stacked}, zoom=${zoom}, font=${font}` }).toEqual({ singleScroll: true, contentFits: true, noPageOverflow: true });
    // Changing only Storage's font must not resize any slot, including its peers.
    const geometry = await page.locator('[data-block-id]').evaluateAll(blocks => blocks.map(block => {
      const box = block.getBoundingClientRect();
      return { id: block.getAttribute('data-block-id'), height: box.height, width: box.width };
    }));
    if (font === 100) baseline = geometry;
    else await expect.poll(() => page.locator('[data-block-id]').evaluateAll((blocks, before) => blocks.flatMap((block, index) => {
      const box = block.getBoundingClientRect();
      return Math.abs(box.height - before[index].height) < 1 && Math.abs(box.width - before[index].width) < 1 ? [] : [{ id: block.getAttribute('data-block-id'), before: before[index], after: { height: box.height, width: box.width } }];
    }), baseline), { message: `font-only geometry ${route}/${stacked}/${zoom}` }).toEqual([]);
    if (route !== "/") {
      const block = page.locator('.block-storage_summary');
      await expect(block).toHaveAttribute('data-monitor-font-scale', String(font));
      expect(await block.evaluate(node => (node as HTMLElement).style.getPropertyValue('--monitor-font-scale'))).toBe(String(font / 100));
    }
    const surface = page.locator(storageScrollSurface);
    await surface.focus();
    await surface.press("End");
    // clientHeight/scrollHeight are rounded, while zoomed scrollTop is fractional.
    // Check the visible last row in the same coordinate system, not mixed rounding.
    await expect.poll(() => surface.evaluate(node => node.querySelector("tbody tr:last-child")!.getBoundingClientRect().bottom - node.getBoundingClientRect().bottom), { message: `End reaches last volume: zoom=${zoom}, font=${font}` }).toBeLessThanOrEqual(1);
  }
});
