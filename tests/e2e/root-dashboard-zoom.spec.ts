import { test, expect, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { adminFixture } from "../fixtures/admin";
import { signIn } from "../fixtures/infrastructure";
import { id } from "../fixtures/dashboard";
import { effectiveOptions, type PresentationDocument } from "../../lib/config/presentation";
import type { Overview, ReadResult } from "../../lib/monitoring/contracts";

async function fixture(page: Page, storage = false) {
  const model = JSON.parse(execFileSync(process.execPath, ["--conditions=react-server", "--input-type=module", "-e", `import { monitorFixture } from './tests/fixtures/monitor-compat.mjs'; process.stdout.write(JSON.stringify(monitorFixture({ includeStorage: ${storage}, split: true, cardSize: 'expanded' })));`], { encoding: "utf8", windowsHide: true })) as { document: PresentationDocument; overview: ReadResult<Overview> };
  const state = await adminFixture(page); state.document = model.document;
  state.document.defaultTvMode = false; state.document.displayScalePercent = 125;
  state.document.publicMonitorAutoScrollOnLoad = false; state.document.showStatusBanner = false;
  const first = state.document.screens[0];
  first.blocks.find(block => block.type === "summary")!.options = { ...effectiveOptions({ type: "summary" }), fontScalePercent: 150 };
  const second = structuredClone(first); second.id = id(9600); second.name = "Tela compacta"; second.layout = "wall"; second.overviewGrid = "default";
  second.blocks.forEach((block, index) => { block.id = id(9610 + index); if (block.type === "summary") block.options = effectiveOptions({ type: "summary" }); if (block.type === "highlighted_resources") block.options = effectiveOptions({ type: "highlighted_resources" }); });
  state.document.screens = [first, second];
  const aggregate = (screenId: string | null) => {
    const screen = state.document.screens.find(item => item.id === screenId) ?? first;
    return { ...model.overview, data: { ...model.overview.data, screenId: screen.id, presentationRevision: state.document.revision, blocks: screen.blocks.filter(block => block.enabled).map(block => ({ ...model.overview.data.blocks.find(item => item.type === block.type)!, blockId: block.id, options: block.options })) } };
  };
  await page.route("**/api/dashboard/overview*", route => route.fulfill({ json: aggregate(new URL(route.request().url()).searchParams.get("screenId")) }));
  await page.route("**/api/public/dashboard/overview*", route => route.fulfill({ json: aggregate(new URL(route.request().url()).searchParams.get("screenId")) }));
  await page.route("**/api/public/settings/presentation", route => route.fulfill({ json: { data: state.document } }));
  return state;
}

for (const storage of [false, true]) test(`root zoom fills the viewport across slides without inheriting monitor zoom, Storage=${storage}`, async ({ page }, testInfo) => {
  test.setTimeout(60000);
  const state = await fixture(page, storage);
  await page.setViewportSize({ width: 1366, height: 768 });
  state.document.publicMonitorZoomPercent = 90;
  await signIn(page);
  const assertFit = async () => {
    const readFit = () => page.locator(".dashboard").evaluate(node => {
      const composition = node.querySelector(".dashboard-blocks")!, footer = node.querySelector(".dashboard-footer")!.getBoundingClientRect();
      const panels = [...node.querySelectorAll(".asgard-panel, .signal-flow-panel, .storage-panel")];
      return { overflow: composition.scrollHeight > composition.clientHeight + 1 || !!node.querySelector('.storage-composition[data-overflow="true"]'), gap: footer.top - Math.max(...panels.map(panel => panel.getBoundingClientRect().bottom)) };
    });
    await expect.poll(async () => { const fit = await readFit(); return fit.overflow ? 0 : fit.gap; }).toBeLessThan(30);
    const fit = await readFit();
    if (!fit.overflow) expect(fit.gap).toBeGreaterThanOrEqual(-1);
  };
  for (const zoom of [50, 70, 100, 125, 150]) {
    state.document.dashboardZoomPercent = zoom; await page.reload();
    await expect(page.locator(".root-dashboard-frame")).toHaveAttribute("data-dashboard-zoom", String(zoom));
    await expect(page.locator(".availability-panel")).toHaveAttribute("data-card-size", "expanded");
    const shell = await page.locator(".dashboard-shell").boundingBox();
    expect(shell!.width).toBeCloseTo(1366, 0);
    expect(await page.locator(".availability-card").first().evaluate(node => node.getBoundingClientRect().height)).toBeCloseTo(140 * zoom / 100, 0);
    await expect(page.locator(".dashboard-footer")).toBeInViewport();
    await assertFit();
    expect(await page.evaluate(() => document.documentElement.scrollHeight)).toBeLessThanOrEqual(769);
    await page.getByLabel("Escolher tela", { exact: true }).selectOption(state.document.screens[1].id);
    await expect(page.locator(".availability-panel")).toHaveAttribute("data-card-size", "compact");
    expect(await page.locator(".availability-card").first().evaluate(node => node.getBoundingClientRect().height)).toBeCloseTo(120 * zoom / 100, 0);
    await expect(page.locator(".dashboard-footer")).toBeInViewport();
    await assertFit();
    if (zoom === 70) await page.screenshot({ path: testInfo.outputPath("root-zoom-70.png") });
  }
  await page.goto("/monitor?compat=0");
  await expect(page.locator(".public-monitor-frame")).toHaveAttribute("data-public-monitor-zoom", "90");
  await expect(page.locator(".root-dashboard-frame")).toHaveCount(0);
  expect(state.writes).toHaveLength(0);
});

test("private zoom composes once with TV and fullscreen, and does not follow navigation to details", async ({ page }) => {
  const state = await fixture(page); state.document.dashboardZoomPercent = 70;
  await page.setViewportSize({ width: 1920, height: 1080 }); await signIn(page);
  const height = () => page.locator(".availability-card").first().evaluate(node => node.getBoundingClientRect().height);
  await expect(page.locator(".root-dashboard-frame")).toHaveAttribute("data-dashboard-zoom", "70");
  expect(await height()).toBeCloseTo(98, 0);
  await page.getByRole("button", { name: "Modo TV", exact: true }).click();
  await expect(page.locator(".dashboard-shell")).toHaveAttribute("data-display-scale", "125");
  expect(await height()).toBeCloseTo(122.5, 0);
  await page.getByRole("button", { name: "Sair do modo TV", exact: true }).click();
  await page.getByRole("button", { name: "Tela cheia", exact: true }).click();
  await expect(page.locator(".dashboard-shell")).toHaveAttribute("data-display-scale", "125");
  expect(await height()).toBeCloseTo(122.5, 0);
  await page.evaluate(() => document.exitFullscreen());
  await expect(page.locator(".dashboard-shell")).toHaveAttribute("data-display-scale", "100");
  await page.getByRole("link", { name: "Configurações", exact: true }).click();
  await expect(page).toHaveURL(/\/admin\/configuracoes$/);
  await expect(page.locator(".root-dashboard-frame")).toHaveCount(0);
  await expect(page.getByLabel("Zoom inicial da Visão geral (%)")).toHaveValue("70");
});

test("root receives an independent zoom revision without replacing the active player", async ({ page }) => {
  const state = await fixture(page); state.document.dashboardZoomPercent = 70;
  await page.clock.install(); await signIn(page);
  await expect(page.locator(".root-dashboard-frame")).toHaveAttribute("data-dashboard-zoom", "70");
  await page.getByLabel("Escolher tela", { exact: true }).selectOption(state.document.screens[1].id);
  state.document.dashboardZoomPercent = 80; state.document.publicMonitorZoomPercent = 50; state.document.revision++;
  await page.clock.fastForward(61000);
  await page.getByRole("button", { name: "Aplicar configuração atualizada", exact: true }).click();
  await expect(page.locator(".root-dashboard-frame")).toHaveAttribute("data-dashboard-zoom", "80");
  await expect(page.getByLabel("Escolher tela", { exact: true })).toHaveValue(state.document.screens[1].id);
  await expect(page.getByRole("button", { name: /rolagem automática/i })).toHaveCount(0);
  expect(state.writes).toHaveLength(0);
});
