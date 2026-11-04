import { test, expect, type Page } from "@playwright/test";
import { adminFixture } from "../fixtures/admin";
import { signIn } from "../fixtures/infrastructure";
import { id, overview } from "../fixtures/dashboard";
import { effectiveOptions } from "../../lib/config/presentation";
import { storageUiFixture } from "../fixtures/storage";

async function fixture(page: Page, split: boolean) {
  const state = await adminFixture(page), screen = state.document.screens[0];
  screen.overviewGrid = split ? "split" : "default";
  screen.blocks.push({ id: id(8800), type: "signal_flow", width: "wide", enabled: true, options: effectiveOptions({ type: "signal_flow" }) });
  if (!split) screen.blocks = screen.blocks.filter(block => block.type !== "problems");
  await page.route("**/api/dashboard/overview*", route => {
    const result = overview(state.document);
    result.data.blocks.forEach(block => { block.options = screen.blocks.find(item => item.id === block.blockId)?.options; });
    return route.fulfill({ json: result });
  });
  return state;
}

for (const split of [true, false]) test(`hidden KPIs release the remaining dashboard height, split=${split}`, async ({ page }, testInfo) => {
  const state = await fixture(page, split), summary = state.document.screens[0].blocks.find(block => block.type === "summary")!;
  summary.enabled = false;
  await page.setViewportSize({ width: 1920, height: 1080 }); await signIn(page);
  for (const viewport of [{ width: 1920, height: 1080 }, { width: 1366, height: 768 }]) {
    await page.setViewportSize(viewport);
    await expect(page.locator(".asgard-panel")).toBeVisible();
    await expect.poll(() => page.locator(".asgard-panel").evaluate(node => node.getBoundingClientRect().height)).toBeGreaterThan(200);
    const geometry = await page.locator(".dashboard").evaluate(node => {
      const footer = node.querySelector(".dashboard-footer")!.getBoundingClientRect();
      const panels = [...node.querySelectorAll(".asgard-panel, .signal-flow-panel")].map(panel => panel.getBoundingClientRect());
      return { gap: footer.top - Math.max(...panels.map(panel => panel.bottom)), bottom: footer.bottom, height: innerHeight, overflow: document.documentElement.scrollHeight };
    });
    expect(geometry.gap).toBeGreaterThanOrEqual(0); expect(geometry.gap).toBeLessThan(25);
    expect(geometry.bottom).toBeLessThanOrEqual(viewport.height + 1); expect(geometry.overflow).toBeLessThanOrEqual(viewport.height + 1);
    await page.getByRole("link", { name: "vm-operacao-15", exact: true }).scrollIntoViewIfNeeded();
    await expect(page.getByRole("link", { name: "vm-operacao-15", exact: true })).toBeInViewport();
  }
  summary.enabled = true; summary.options = { ...effectiveOptions(summary), fontScalePercent: 150 };
  state.document.revision++; await page.reload();
  await expect(page.locator(".dashboard-kpis")).toBeVisible();
  await expect(page.locator(".dashboard-footer")).toBeInViewport();
  summary.enabled = false; state.document.revision++; await page.reload();
  await expect(page.locator(".dashboard-kpis")).toHaveCount(0);
  await expect.poll(() => page.locator(".asgard-panel").evaluate(node => node.getBoundingClientRect().height)).toBeGreaterThan(200);
  await page.screenshot({ path: testInfo.outputPath("hidden-kpis.png") });
  expect(state.writes).toHaveLength(0);
});

test("KPI font scale previews, persists and stays independent from reading saves", async ({ page }) => {
  const state = await fixture(page, true);
  await page.setViewportSize({ width: 1920, height: 1080 }); await signIn(page); await page.goto("/admin/configuracoes");
  const scale = page.getByLabel("Tamanho dos textos dos KPIs", { exact: true });
  await expect(scale).toHaveValue("100"); await scale.selectOption("150");
  await page.getByRole("button", { name: "Ver prévia", exact: true }).click();
  const preview = page.locator(".dashboard-preview");
  await expect(preview.locator(".dashboard-kpis")).toHaveAttribute("data-kpi-font-scale", "150");
  const font = () => preview.locator(".kpi-value").first().evaluate(node => parseFloat(getComputedStyle(node).fontSize));
  const enlarged = await font();
  await scale.selectOption("100"); await expect.poll(font).toBeCloseTo(enlarged / 1.5, 1);
  await scale.selectOption("150");
  await page.getByRole("button", { name: "Salvar leitura do telão", exact: true }).click();
  await expect.poll(() => state.writes.length).toBe(1);
  expect(effectiveOptions({ ...state.document.screens[0].blocks[0], type: "summary" }).fontScalePercent).toBe(100);
  await expect(scale).toHaveValue("150");
  await page.getByRole("button", { name: "Salvar apresentação", exact: true }).click();
  await expect.poll(() => effectiveOptions({ ...state.document.screens[0].blocks[0], type: "summary" }).fontScalePercent).toBe(150);
  await page.reload(); await expect(scale).toHaveValue("150");
  await page.getByRole("button", { name: "Restaurar textos dos KPIs", exact: true }).click();
  await expect(scale).toHaveValue("100");
  expect(effectiveOptions({ ...state.document.screens[0].blocks[0], type: "summary" }).fontScalePercent).toBe(150);
});

test("public React monitor fills its viewport without KPIs across zooms and scales only KPI text", async ({ page }) => {
  const state = await fixture(page, true), summary = state.document.screens[0].blocks[0];
  summary.enabled = false; state.document.publicMonitorAutoScrollOnLoad = false;
  await page.route("**/api/public/settings/presentation", route => route.fulfill({ json: { data: state.document } }));
  await page.route("**/api/public/dashboard/overview*", route => {
    const result = overview(state.document);
    result.data.blocks.forEach(block => { block.options = state.document.screens[0].blocks.find(item => item.id === block.blockId)?.options; });
    return route.fulfill({ json: result });
  });
  await page.setViewportSize({ width: 1280, height: 720 });
  for (const zoom of [50, 70, 100, 125, 150]) {
    state.document.publicMonitorZoomPercent = zoom;
    await page.goto("/monitor?compat=0");
    await expect(page.locator(".public-monitor-frame")).toHaveAttribute("data-public-monitor-zoom", String(zoom));
    await expect(page.locator(".asgard-panel")).toBeVisible();
    await page.locator(".asgard-panel").scrollIntoViewIfNeeded();
    const geometry = await page.locator(".dashboard").evaluate(node => {
      const panel = node.querySelector(".asgard-panel")!.getBoundingClientRect(), footer = node.querySelector(".dashboard-footer")!.getBoundingClientRect();
      return { gap: footer.top - panel.bottom, bottom: footer.bottom, height: panel.height };
    });
    expect(geometry.height).toBeGreaterThan(80);
    if (zoom <= 100) { expect(geometry.gap).toBeGreaterThanOrEqual(-1); expect(geometry.gap).toBeLessThan(25); }
    expect(geometry.bottom).toBeLessThanOrEqual(721);
    expect(await page.locator(".vm-table-scroll").evaluate(node => node.clientHeight)).toBeGreaterThan(20);
  }
  state.document.publicMonitorZoomPercent = 100; summary.enabled = true;
  summary.options = effectiveOptions({ type: "summary" });
  await page.reload(); await expect(page.locator(".dashboard-kpis")).toBeVisible();
  const measure = () => page.locator(".dashboard").evaluate(node => ({
    value: parseFloat(getComputedStyle(node.querySelector(".kpi-value")!).fontSize),
    label: parseFloat(getComputedStyle(node.querySelector(".kpi-label")!).fontSize),
    icon: node.querySelector(".kpi-label svg")!.getBoundingClientRect().width,
    other: getComputedStyle(node.querySelector(".availability-name")!).fontSize,
  }));
  const original = await measure();
  for (const scale of [110, 125, 150]) {
    summary.options = { ...summary.options, fontScalePercent: scale }; state.document.revision++;
    await page.reload(); await expect(page.locator(".dashboard-kpis")).toHaveAttribute("data-kpi-font-scale", String(scale));
    const current = await measure();
    expect(current.value).toBeCloseTo(original.value * scale / 100, 1);
    expect(current.label).toBeCloseTo(original.label * scale / 100, 1);
    expect(current.icon).toBe(original.icon); expect(current.other).toBe(original.other);
    await expect(page.locator(".dashboard-footer")).toBeInViewport();
  }
});

test("Storage composition and preview reclaim KPI space and multiple KPI bands keep independent scales", async ({ page }) => {
  const state = await storageUiFixture(page), screen = state.admin.document.screens[0];
  screen.blocks.push({ id: id(8801), type: "storage_summary", width: "wide", enabled: true, options: { storageConfigId: state.configs[0].id, visibleRows: 3 } });
  const summary = screen.blocks[0]; summary.enabled = false;
  await page.setViewportSize({ width: 1920, height: 1080 }); await signIn(page);
  await expect(page.locator("[data-storage-layout]")).toHaveAttribute("data-overflow", "false");
  await expect(page.locator(".storage-panel")).toBeVisible();
  await expect.poll(() => page.locator(".storage-panel").evaluate(node => node.getBoundingClientRect().height)).toBeGreaterThan(210);
  await expect(page.locator(".dashboard-footer")).toBeInViewport();
  summary.enabled = true; summary.options = { indicators: ["hosts"], fontScalePercent: 150 };
  screen.blocks.push({ ...structuredClone(summary), id: id(8802), options: { indicators: ["problems"], fontScalePercent: 100 } });
  state.admin.document.revision++; await page.reload();
  await expect(page.locator(".dashboard-kpis")).toHaveCount(2);
  await expect(page.locator(".dashboard-kpis").first()).toHaveAttribute("data-kpi-font-scale", "150");
  await expect(page.locator(".dashboard-kpis").last()).toHaveAttribute("data-kpi-font-scale", "100");
  const fonts = await page.locator(".kpi-value").evaluateAll(nodes => nodes.map(node => parseFloat(getComputedStyle(node).fontSize)));
  expect(fonts[0]).toBeCloseTo(fonts[1] * 1.5, 1);
  await page.goto("/admin/configuracoes"); await page.getByRole("button", { name: "Ver prévia", exact: true }).click();
  await expect(page.locator(".dashboard-preview .dashboard-kpis")).toHaveCount(2);
  expect(state.admin.writes).toHaveLength(0);
});

test("large stale KPI values remain readable on mobile without enlarging other controls", async ({ page }) => {
  const state = await fixture(page, true), summary = state.document.screens[0].blocks[0];
  state.document.screens[0].blocks = [summary];
  summary.options = { ...effectiveOptions({ type: "summary" }), fontScalePercent: 150 };
  await page.route("**/api/dashboard/overview*", route => {
    const result = overview(state.document, undefined, true);
    result.data.summary.hostsKnown = 1234567890;
    result.data.blocks[0].options = summary.options;
    return route.fulfill({ json: result });
  });
  await page.setViewportSize({ width: 390, height: 844 }); await signIn(page);
  await expect(page.locator(".dashboard-kpis.is-stale")).toBeVisible();
  for (const count of [1, 2, 3, 4]) {
    summary.options = { ...summary.options, indicators: ["hosts", "containers_running", "containers_stopped", "problems"].slice(0, count) };
    state.document.revision++; await page.reload();
    await expect(page.locator(".dashboard-kpi")).toHaveCount(count);
    await expect(page.locator(".overview-split-grid")).toHaveCount(0);
    expect(await page.locator(".dashboard-kpi").first().evaluate(node => node.scrollWidth <= node.clientWidth + 1)).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
  await page.goto("/admin/configuracoes"); await page.getByRole("button", { name: "Ver prévia", exact: true }).click();
  await expect(page.locator(".dashboard-preview .dashboard-kpis")).toBeVisible();
  await expect(page.locator(".dashboard-preview .overview-split-grid")).toHaveCount(0);
});
