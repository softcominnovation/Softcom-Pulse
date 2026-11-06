import { test, expect } from "@playwright/test";
import { storageUiFixture } from "../fixtures/storage";
import { slotUiFixture } from "../fixtures/overview-slots";
import { signIn } from "../fixtures/infrastructure";

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

for (const route of ["/", "/monitor?compat=0"]) for (const stacked of [false, true]) test(`Storage scrolls only volumes with fixed readings and footer across zoom/font scales: ${route} stacked=${stacked}`, async ({ page }) => {
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
    const panel = page.locator('.dashboard-block .storage-panel');
    await expect(panel.locator("tbody tr")).toHaveCount(10);
    await expect.poll(() => panel.evaluate(element => {
      const body = element.querySelector<HTMLElement>(".storage-body")!, volumes = element.querySelector<HTMLElement>(".storage-volumes")!;
      const head = volumes.querySelector("thead")!.getBoundingClientRect(), firstRow = volumes.querySelector("tbody tr")!.getBoundingClientRect();
      const fixed = [...body.children].filter(child => child !== volumes).map(child => child.getBoundingClientRect());
      const bodyBounds = body.getBoundingClientRect(), tableBounds = volumes.getBoundingClientRect();
      return {
        outerScroll: [element, body].some(node => /auto|scroll/.test(getComputedStyle(node).overflowY)),
        tableScroll: getComputedStyle(volumes).overflowY === "auto" && volumes.scrollHeight > volumes.clientHeight + 1,
        rowFits: tableBounds.bottom >= firstRow.bottom - 1 && head.top >= tableBounds.top - 1,
        fixedFits: fixed.every(box => box.top >= bodyBounds.top - 1 && box.bottom <= bodyBounds.bottom + 1),
        noPageOverflow: document.documentElement.scrollWidth <= innerWidth + 1,
      };
    }), { message: `${route}, stacked=${stacked}, zoom=${zoom}, font=${font}` }).toEqual({ outerScroll: false, tableScroll: true, rowFits: true, fixedFits: true, noPageOverflow: true });
    // Changing only Storage's font must not resize any slot, including its peers.
    const geometry = await page.locator('[data-block-id]').evaluateAll(blocks => blocks.map(block => {
      const box = block.getBoundingClientRect();
      return { id: block.getAttribute('data-block-id'), height: box.height, width: box.width };
    }));
    if (font === 100) baseline = geometry;
    else for (const [index, block] of geometry.entries()) {
      expect(block.id).toBe(baseline[index].id);
      expect(Math.abs(block.height - baseline[index].height), `font-only height ${route}/${stacked}/${zoom}/${block.id}`).toBeLessThan(1);
      expect(Math.abs(block.width - baseline[index].width)).toBeLessThan(1);
    }
    if (route !== "/") {
      const block = page.locator('.block-storage_summary');
      await expect(block).toHaveAttribute('data-monitor-font-scale', String(font));
      expect(await block.evaluate(node => (node as HTMLElement).style.getPropertyValue('--monitor-font-scale'))).toBe(String(font / 100));
    }
    await panel.locator(".storage-volumes").focus();
    await panel.locator(".storage-volumes").press("End");
    // clientHeight/scrollHeight are rounded, while zoomed scrollTop is fractional.
    // Check the visible last row in the same coordinate system, not mixed rounding.
    await expect.poll(() => panel.locator(".storage-volumes").evaluate(node => node.querySelector("tbody tr:last-child")!.getBoundingClientRect().bottom - node.getBoundingClientRect().bottom), { message: `End reaches last volume: zoom=${zoom}, font=${font}` }).toBeLessThanOrEqual(1);
  }
});
