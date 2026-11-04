import { test, expect, type Page, type Locator } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { adminFixture } from "../fixtures/admin";
import { signIn } from "../fixtures/infrastructure";
import { id } from "../fixtures/dashboard";
import { effectiveOptions, type PresentationDocument } from "../../lib/config/presentation";
import type { Overview, ReadResult, AvailabilityPanelData } from "../../lib/monitoring/contracts";

async function fixture(page: Page, split = false, storage = false) {
  const model = JSON.parse(execFileSync(process.execPath, ["--conditions=react-server", "--input-type=module", "-e", `import { monitorFixture } from './tests/fixtures/monitor-compat.mjs'; process.stdout.write(JSON.stringify(monitorFixture({ includeStorage: ${storage}, split: ${split}, cardSize: 'expanded' })));`], { encoding: "utf8", windowsHide: true })) as { document: PresentationDocument; overview: ReadResult<Overview> };
  const state = await adminFixture(page); state.document = model.document;
  state.document.defaultTvMode = false; state.document.displayScalePercent = 100;
  state.document.publicMonitorAutoScrollOnLoad = false;
  const screen = state.document.screens[0], highlights = screen.blocks.find(block => block.type === "highlighted_resources")!;
  highlights.options = { ...effectiveOptions({ ...highlights, type: "highlighted_resources" }), visibleRows: 2 };
  if (split) {
    screen.blocks.push({ id: id(8200), type: "problems", width: "wide", enabled: true, options: effectiveOptions({ type: "problems" }) });
    model.overview.data.blocks.push({ blockId: id(8200), type: "problems", data: [], availability: "ready", stale: false, lastUpdated: model.overview.lastUpdated });
  }
  const panel = model.overview.data.blocks.find(block => block.type === "highlighted_resources")!.data as AvailabilityPanelData;
  const originals = structuredClone(panel.cards);
  function count(total: number) {
    panel.cards = Array.from({ length: total }, (_, index) => {
      const card = structuredClone(originals[index % originals.length]);
      if (card.kind === "storage") { card.item.storageKey += index; card.item.configId = id(8300 + index); }
      else { card.item.id = id(8300 + index); if (card.kind === "resource") card.item.config.id = card.item.id; }
      return card;
    });
  }
  const aggregate = () => ({ ...model.overview, data: { ...model.overview.data, screenId: state.document.screens[0].id, presentationRevision: state.document.revision, blocks: state.document.screens[0].blocks.filter(block => block.enabled).map(block => ({ ...model.overview.data.blocks.find(item => item.blockId === block.id)!, options: block.options })) } });
  await page.route("**/api/dashboard/overview*", route => route.fulfill({ json: aggregate() }));
  await page.route("**/api/public/dashboard/overview*", route => route.fulfill({ json: aggregate() }));
  await page.route("**/api/public/settings/presentation", route => route.fulfill({ json: { data: state.document } }));
  return { state, highlights, panel, count };
}

async function geometry(grid: Locator) {
  return grid.evaluate(node => {
    const cards = [...node.querySelectorAll<HTMLElement>(".availability-card")];
    return {
      columns: getComputedStyle(node).gridTemplateColumns.split(" ").length,
      width: node.clientWidth,
      cards: cards.map(card => ({ width: card.getBoundingClientRect().width, height: card.getBoundingClientRect().height, fits: card.scrollHeight <= card.clientHeight + 1 && card.scrollWidth <= card.clientWidth + 1, font: parseFloat(getComputedStyle(card.querySelector(".availability-name")!).fontSize), footer: card.querySelector(".availability-footer")!.getBoundingClientRect().bottom <= card.getBoundingClientRect().bottom })),
      headers: cards.map(card => {
        const name = card.querySelector(".availability-name")!.getBoundingClientRect(), badge = card.querySelector(".availability-state")!.getBoundingClientRect();
        return { gap: badge.left - name.right, offset: Math.abs((name.top + name.bottom - badge.top - badge.bottom) / 2), background: getComputedStyle(card.querySelector(".availability-state")!).backgroundColor };
      }),
    };
  });
}

for (const split of [false, true]) for (const storage of [false, true]) for (const hasKpis of [false, true]) test(`expanded availability exposes complete rows before scrolling, split=${split}, Storage=${storage}, KPIs=${hasKpis}`, async ({ page }, testInfo) => {
  const { count, state } = await fixture(page, split, storage);
  state.document.showStatusBanner = false;
  state.document.screens[0].blocks.find(block => block.type === "summary")!.enabled = hasKpis;
  const limit = split && !hasKpis ? 3 : 2;
  await page.setViewportSize({ width: 1920, height: 1440 }); await signIn(page);
  const grid = page.locator(".availability-grid");
  for (const total of split ? [1, 6, 9, 10] : [1, 7, 12, 13]) {
    count(total); await page.reload(); await expect(page.locator(".availability-card")).toHaveCount(total);
    const bounds = await grid.evaluate(node => {
      const box = node.getBoundingClientRect(), style = getComputedStyle(node);
      return { top: box.top, bottom: box.bottom - parseFloat(style.paddingBottom), height: box.height, columns: style.gridTemplateColumns.split(" ").length, scroll: node.scrollHeight - node.clientHeight, cards: [...node.querySelectorAll(".availability-card")].map(card => ({ top: card.getBoundingClientRect().top, bottom: card.getBoundingClientRect().bottom })) };
    });
    const rows = Math.min(limit, Math.ceil(total / bounds.columns));
    expect(bounds.height).toBeCloseTo(rows * 140 + (rows - 1) * 8 + 8, 0);
    for (const card of bounds.cards.slice(0, bounds.columns * limit)) {
      expect(card.top).toBeGreaterThanOrEqual(bounds.top - 1);
      expect(card.bottom).toBeLessThanOrEqual(bounds.bottom + 1);
    }
    if (total > bounds.columns * limit) {
      expect(bounds.scroll).toBeGreaterThan(0);
      expect(bounds.cards[bounds.columns * limit].top).toBeGreaterThanOrEqual(bounds.bottom + 7.9);
      await grid.locator(".availability-card").last().scrollIntoViewIfNeeded(); await expect(grid.locator(".availability-card").last()).toBeInViewport();
    } else expect(bounds.scroll).toBeLessThanOrEqual(1);
    await expect(page.locator(".dashboard-footer")).toBeInViewport();
  }
  expect(state.writes).toHaveLength(0);
  await page.screenshot({ path: testInfo.outputPath("complete-rows.png") });
});

test("expanded availability gives every family one readable envelope, including long names and paused strips", async ({ page }, testInfo) => {
  const { panel, count } = await fixture(page);
  for (const card of panel.cards) {
    if (card.kind === "external_service") { card.item.paused = true; card.item.description = "Descrição extensa de aplicação para validar reticências sem aumentar a caixa"; }
    if (card.kind === "resource") { card.item.config.displayName = "Serviço com nome extenso que permanece completo no nome acessível"; card.item.config.description = "Uma descrição longa para validar o alinhamento do rodapé"; }
  }
  await page.setViewportSize({ width: 1920, height: 1080 }); await signIn(page);
  for (const theme of ["dark", "light"]) {
    await page.evaluate(theme => { document.documentElement.classList.toggle("dark", theme === "dark"); document.documentElement.dataset.theme = theme; }, theme);
    const current = await geometry(page.locator(".availability-grid"));
    expect(current.cards).toHaveLength(6);
    for (const card of current.cards) { expect(card.height).toBe(140); expect(card.font).toBe(15); expect(card.fits).toBe(true); expect(card.footer).toBe(true); }
    for (const header of current.headers) { expect(header.gap).toBeGreaterThanOrEqual(7.9); expect(header.offset).toBeLessThanOrEqual(2); expect(header.background).not.toBe("rgba(0, 0, 0, 0)"); }
    await expect(page.locator(".probe-card").first()).toContainText("Pausado");
    await page.screenshot({ path: testInfo.outputPath(`expanded-${theme}.png`) });
  }
  for (const total of [1, 3, 4, 8, 20]) {
    count(total); await page.reload();
    await expect(page.locator(".availability-card")).toHaveCount(total);
    const current = await geometry(page.locator(".availability-grid"));
    expect(current.cards[0].width).toBeGreaterThanOrEqual(260); expect(current.cards[0].width).toBeLessThan(current.width / 2);
    for (const card of current.cards) expect(card.height).toBe(140);
  }
});

for (const storage of [false, true]) test(`paired expanded availability uses container width and at most three columns, Storage=${storage}`, async ({ page }) => {
  const { count, state } = await fixture(page, true, storage); count(20);
  state.document.screens[0].blocks[0].enabled = false;
  await signIn(page);
  for (const width of [3440, 1920, 1366, 390]) {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 1080 });
    const current = await geometry(page.locator(".availability-grid"));
    expect(current.columns).toBeLessThanOrEqual(3);
    expect(current.columns).toBe(width === 390 ? 1 : width === 1366 ? 2 : 3);
    for (const card of current.cards) { expect(card.width).toBeGreaterThanOrEqual(Math.min(260, current.width - 50)); expect(card.fits).toBe(true); }
    await page.locator(".availability-card").last().scrollIntoViewIfNeeded();
    await expect(page.locator(".availability-card").last()).toBeInViewport();
    if (width > 1200) await expect(page.locator(".dashboard-footer")).toBeInViewport();
  }
});

test("expanded cards scale with TV once and keep their full footer and the composition accessible", async ({ page }) => {
  const { state } = await fixture(page, true); state.document.displayScalePercent = 125;
  await page.setViewportSize({ width: 1366, height: 768 }); await signIn(page);
  await page.getByRole("button", { name: "Modo TV", exact: true }).click();
  await expect(page.locator(".dashboard-shell")).toHaveAttribute("data-display-scale", "125");
  const current = await geometry(page.locator(".availability-grid"));
  for (const card of current.cards) { expect(card.height).toBe(175); expect(card.font).toBe(18.75); expect(card.fits).toBe(true); }
  await page.locator(".asgard-panel").scrollIntoViewIfNeeded();
  await expect(page.locator(".asgard-panel")).toBeInViewport(); await expect(page.locator(".dashboard-footer")).toBeInViewport();
});

for (const configuredRows of [1, 2]) test(`size selection previews locally, saves per block and restores compact rows=${configuredRows}`, async ({ page }) => {
  const { state, highlights } = await fixture(page); highlights.options!.cardSize = "compact";
  highlights.options!.visibleRows = configuredRows;
  highlights.options!.rowMode = "manual";
  await page.setViewportSize({ width: 1920, height: 1080 }); await signIn(page); await page.goto("/admin/configuracoes");
  const screen = page.getByRole("region", { name: "Tela 1", exact: true });
  const size = screen.getByLabel("Tamanho dos minicards", { exact: true });
  await expect(size).toHaveValue("compact"); await size.selectOption("expanded");
  await screen.getByRole("button", { name: "Ver prévia", exact: true }).click();
  const preview = page.locator(".dashboard-preview .availability-panel");
  await expect(preview).toHaveAttribute("data-card-size", "expanded");
  await expect.poll(() => preview.locator(".availability-card").first().evaluate(node => node.getBoundingClientRect().height)).toBe(140);
  await page.getByRole("button", { name: "Salvar leitura do telão", exact: true }).click();
  await expect.poll(() => state.writes.length).toBe(1);
  expect(state.document.screens[0].blocks.find(block => block.type === "highlighted_resources")!.options!.cardSize).toBe("compact");
  await expect(size).toHaveValue("expanded");
  await page.getByRole("button", { name: "Salvar apresentação", exact: true }).click();
  await expect.poll(() => state.document.screens[0].blocks.find(block => block.type === "highlighted_resources")!.options!.cardSize).toBe("expanded");
  expect(state.document.screens[0].blocks.find(block => block.type === "highlighted_resources")!.options!.visibleRows).toBe(configuredRows);
  expect(effectiveOptions({ ...state.document.screens[1].blocks.find(block => block.type === "highlighted_resources")!, type: "highlighted_resources" }).cardSize).toBe("compact");
  await page.reload(); await expect(size).toHaveValue("expanded");
  await expect(screen.getByLabel("Fileiras visíveis", { exact: true })).toHaveValue(String(configuredRows));
  await size.selectOption("compact");
  await expect(screen.getByLabel("Fileiras visíveis", { exact: true })).toHaveValue(String(configuredRows));
  await page.getByRole("button", { name: "Salvar apresentação", exact: true }).click();
  await page.goto("/"); await expect.poll(() => page.locator(".availability-card").first().evaluate(node => node.getBoundingClientRect().height)).toBe(120);
});

test("draft KPI visibility updates expanded row guidance and preview without saving", async ({ page }) => {
  const { state } = await fixture(page, true);
  await page.setViewportSize({ width: 1920, height: 1440 }); await signIn(page); await page.goto("/admin/configuracoes");
  const screen = page.getByRole("region", { name: "Tela 1", exact: true });
  await screen.getByRole("button", { name: "Ver prévia", exact: true }).click();
  const preview = page.locator(".dashboard-preview .availability-panel");
  await expect(screen).toContainText("2 completas no bloco dividido com KPIs");
  await expect(preview).toHaveAttribute("data-service-rows", "2");
  const enabled = screen.getByRole("article", { name: "Indicadores na tela 1", exact: true }).getByLabel("Bloco habilitado", { exact: true });
  await enabled.uncheck();
  await expect(screen).toContainText("3 completas no bloco dividido sem KPIs");
  await expect(preview).toHaveAttribute("data-service-rows", "3");
  await enabled.check();
  await expect(preview).toHaveAttribute("data-service-rows", "2");
  expect(state.writes).toHaveLength(0);
});

for (const size of ["compact", "expanded"] as const) for (const split of [false, true]) for (const storage of [false, true]) test(`manual whole rows override KPIs and layout: ${size}, split=${split}, Storage=${storage}`, async ({ page }, testInfo) => {
  test.setTimeout(60000);
  const { state, highlights, count } = await fixture(page, split, storage); count(25);
  const summary = state.document.screens[0].blocks.find(block => block.type === "summary")!;
  if (size === "expanded" && split && !storage) summary.options = { ...effectiveOptions(summary), fontScalePercent: 150 };
  highlights.options!.cardSize = size; highlights.options!.rowMode = "manual";
  await page.setViewportSize({ width: 1920, height: 1440 }); await signIn(page);
  const grid = page.locator(".availability-grid"), height = size === "compact" ? 120 : 140;
  for (const rows of [1, 2, 3]) {
    highlights.options!.visibleRows = rows; await page.reload();
    await expect(page.locator(".availability-panel")).toHaveAttribute("data-row-mode", "manual");
    await expect(page.locator(".availability-panel")).toHaveAttribute("data-service-rows", String(rows));
    const bounds = await grid.evaluate(node => ({ top: node.getBoundingClientRect().top, bottom: node.getBoundingClientRect().bottom, height: node.getBoundingClientRect().height, columns: getComputedStyle(node).gridTemplateColumns.split(" ").length, scroll: node.scrollHeight - node.clientHeight, cards: [...node.querySelectorAll(".availability-card")].map(card => ({ top: card.getBoundingClientRect().top, bottom: card.getBoundingClientRect().bottom })) }));
    expect(bounds.height).toBeCloseTo(rows * (height + 8), 0);
    for (const card of bounds.cards.slice(0, bounds.columns * rows)) { expect(card.top).toBeGreaterThanOrEqual(bounds.top - 1); expect(card.bottom).toBeLessThanOrEqual(bounds.bottom - 7); }
    expect(bounds.cards[bounds.columns * rows].top).toBeGreaterThanOrEqual(bounds.bottom - 0.1);
    expect(bounds.scroll).toBeGreaterThan(0);
    if (rows === 3) await page.screenshot({ path: testInfo.outputPath("manual-three-rows.png") });
    await grid.locator(".availability-card").last().scrollIntoViewIfNeeded(); await expect(grid.locator(".availability-card").last()).toBeInViewport();
    await expect(page.locator(".dashboard-footer")).toBeInViewport();
  }
  summary.enabled = false; await page.reload();
  await expect(page.locator(".availability-panel")).toHaveAttribute("data-service-rows", "3");
  expect(state.writes).toHaveLength(0);
});

test("manual rows preview and persist per block, survive layout and profile changes, and can return to auto", async ({ page }) => {
  test.setTimeout(60000);
  const { state } = await fixture(page, true);
  await page.setViewportSize({ width: 1920, height: 1440 }); await signIn(page); await page.goto("/admin/configuracoes");
  const screen = page.getByRole("region", { name: "Tela 1", exact: true }), rows = screen.getByLabel("Fileiras visíveis", { exact: true });
  await expect(rows).toHaveValue("auto"); await rows.selectOption("3");
  await screen.getByRole("button", { name: "Ver prévia", exact: true }).click();
  const preview = page.locator(".dashboard-preview .availability-panel");
  await expect(preview).toHaveAttribute("data-service-rows", "3");
  await screen.getByLabel("Grade da visão geral", { exact: true }).selectOption("default");
  await expect(rows).toHaveValue("3"); await expect(preview).toHaveAttribute("data-service-rows", "3");
  await screen.getByLabel("Grade da visão geral", { exact: true }).selectOption("split");
  await screen.getByLabel("Tamanho dos minicards", { exact: true }).selectOption("compact");
  await expect(rows).toHaveValue("3"); await expect(preview).toHaveAttribute("data-service-rows", "3");
  await page.getByRole("button", { name: "Salvar leitura do telão", exact: true }).click();
  await expect.poll(() => state.writes.length).toBe(1);
  expect(state.document.screens[0].blocks.find(block => block.type === "highlighted_resources")!.options!.rowMode).toBeUndefined();
  await expect(rows).toHaveValue("3");
  await page.getByRole("button", { name: "Salvar apresentação", exact: true }).click();
  await expect.poll(() => state.document.screens[0].blocks.find(block => block.type === "highlighted_resources")!.options!.rowMode).toBe("manual");
  expect(state.document.screens[0].blocks.find(block => block.type === "highlighted_resources")!.options!.visibleRows).toBe(3);
  expect(state.document.screens[1].blocks.find(block => block.type === "highlighted_resources")!.options!.rowMode).toBeUndefined();
  await page.reload(); await expect(rows).toHaveValue("3");
  await rows.selectOption("auto");
  await page.getByRole("button", { name: "Salvar apresentação", exact: true }).click();
  await expect.poll(() => state.document.screens[0].blocks.find(block => block.type === "highlighted_resources")!.options!.rowMode).toBe("auto");
  await page.goto("/"); await expect(page.locator(".availability-panel")).toHaveAttribute("data-service-rows", "2");
});

for (const size of ["compact", "expanded"] as const) test(`public manual rows stay complete under configured zoom, ${size}`, async ({ page }) => {
  const { state, highlights, count } = await fixture(page, true); count(25);
  highlights.options = { ...highlights.options, cardSize: size, rowMode: "manual", visibleRows: 3 };
  state.document.publicMonitorZoomPercent = 70;
  await page.setViewportSize({ width: 1280, height: 720 }); await page.goto("/monitor?compat=0");
  await expect(page.locator(".availability-panel")).toHaveAttribute("data-service-rows", "3");
  const bounds = await page.locator(".availability-grid").evaluate(node => ({ bottom: node.getBoundingClientRect().bottom, height: node.getBoundingClientRect().height, columns: getComputedStyle(node).gridTemplateColumns.split(" ").length, cards: [...node.querySelectorAll(".availability-card")].map(card => ({ top: card.getBoundingClientRect().top, bottom: card.getBoundingClientRect().bottom })) }));
  expect(bounds.height).toBeCloseTo(3 * (size === "compact" ? 128 : 148) * 0.7, 0);
  for (const card of bounds.cards.slice(0, bounds.columns * 3)) expect(card.bottom).toBeLessThanOrEqual(bounds.bottom + 1);
  expect(bounds.cards[bounds.columns * 3].top).toBeGreaterThanOrEqual(bounds.bottom - 0.1);
  await expect(page.locator(".dashboard-footer")).toBeInViewport();
});

for (const size of ["compact", "expanded"] as const) test(`private manual rows respect root zoom and TV scale, ${size}`, async ({ page }) => {
  const { state, highlights, count } = await fixture(page, true, true); count(25);
  highlights.options = { ...highlights.options, cardSize: size, rowMode: "manual", visibleRows: 3 };
  state.document.dashboardZoomPercent = 70; state.document.displayScalePercent = 125;
  await page.setViewportSize({ width: 1366, height: 768 }); await signIn(page);
  await expect(page.locator(".availability-panel")).toHaveAttribute("data-row-mode", "manual");
  await page.getByRole("button", { name: "Modo TV", exact: true }).click();
  await expect(page.locator(".dashboard-shell")).toHaveAttribute("data-display-scale", "125");
  await expect(page.locator(".availability-panel")).toHaveAttribute("data-service-rows", "3");
  const height = await page.locator(".availability-grid").evaluate(node => node.getBoundingClientRect().height);
  expect(height).toBeCloseTo(3 * (size === "compact" ? 128 : 148 * 1.25) * 0.7, 0);
  await page.locator(".availability-card").last().scrollIntoViewIfNeeded(); await expect(page.locator(".availability-card").last()).toBeInViewport();
  await page.locator(".storage-panel").scrollIntoViewIfNeeded();
  await expect(page.locator(".dashboard-footer")).toBeInViewport();
});

for (const hasKpis of [false, true]) test(`public expanded cards respect configured zoom and automatic rows, KPIs=${hasKpis}`, async ({ page }) => {
  const { state, count } = await fixture(page, true); count(10);
  const summary = state.document.screens[0].blocks.find(block => block.type === "summary")!;
  summary.enabled = hasKpis; summary.options = { ...effectiveOptions(summary), fontScalePercent: 150 };
  const limit = hasKpis ? 2 : 3;
  await page.setViewportSize({ width: 1280, height: 720 });
  let logicalKpiHeight = 0;
  for (const zoom of [70, 100, 125]) {
    state.document.publicMonitorZoomPercent = zoom;
    await page.goto("/monitor?compat=0");
    await expect(page.locator(".availability-panel")).toHaveAttribute("data-card-size", "expanded");
    const current = await geometry(page.locator(".availability-grid"));
    for (const card of current.cards) expect(card.height).toBeCloseTo(140 * zoom / 100, 1);
    const rows = await page.locator(".availability-grid").evaluate(node => ({ bottom: node.getBoundingClientRect().bottom, cards: [...node.querySelectorAll(".availability-card")].map(card => ({ top: card.getBoundingClientRect().top, bottom: card.getBoundingClientRect().bottom })) }));
    for (const card of rows.cards.slice(0, current.columns * limit)) expect(card.bottom).toBeLessThanOrEqual(rows.bottom + 1);
    expect(rows.cards[current.columns * limit].top + 0.1).toBeGreaterThanOrEqual(rows.bottom);
    await expect(page.locator(".availability-panel")).toHaveAttribute("data-service-rows", String(limit));
    if (hasKpis) {
      await expect(page.locator(".dashboard-kpis")).toHaveAttribute("data-kpi-font-scale", "150");
      const height = await page.locator(".kpi-value").first().evaluate(node => node.getBoundingClientRect().height);
      if (!logicalKpiHeight) logicalKpiHeight = height / (zoom / 100);
      expect(height).toBeCloseTo(logicalKpiHeight * zoom / 100, 0);
    }
    await expect(page.locator(".dashboard-shell")).toHaveAttribute("data-display-scale", "100");
    await expect(page.locator(".dashboard-footer")).toBeInViewport();
  }
  const vps = page.locator(".vps-card-highlight"); await vps.scrollIntoViewIfNeeded(); await vps.click();
  await expect(page.getByRole("dialog")).toBeVisible(); await expect(page.getByRole("link", { name: "Abrir em VPS", exact: true })).toBeVisible();
});

test("private normal view keeps neutral global scale and does not inherit monitor zoom", async ({ page }) => {
  const { state, count } = await fixture(page, true); count(10);
  state.document.displayScalePercent = 125;
  state.document.publicMonitorZoomPercent = 70;
  const summary = state.document.screens[0].blocks.find(block => block.type === "summary")!;
  summary.options = { ...effectiveOptions(summary), fontScalePercent: 150 };
  await page.setViewportSize({ width: 1920, height: 1080 }); await signIn(page);
  await expect(page.locator(".dashboard-shell")).toHaveAttribute("data-display-scale", "100");
  const card = page.locator(".availability-card").first();
  expect(await card.evaluate(node => node.getBoundingClientRect().height)).toBe(140);
  const font = await page.locator(".kpi-value").first().evaluate(node => getComputedStyle(node).fontSize);
  summary.enabled = false; state.document.revision++; await page.reload();
  await expect(page.locator(".availability-panel")).toHaveAttribute("data-service-rows", "3");
  summary.enabled = true; state.document.publicMonitorZoomPercent = 125; state.document.revision++; await page.reload();
  await expect(page.locator(".availability-panel")).toHaveAttribute("data-service-rows", "2");
  expect(await card.evaluate(node => node.getBoundingClientRect().height)).toBe(140);
  expect(await page.locator(".kpi-value").first().evaluate(node => getComputedStyle(node).fontSize)).toBe(font);
  expect(state.writes).toHaveLength(0);
});
