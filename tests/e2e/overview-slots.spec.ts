import { test, expect, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { storageUiFixture } from "../fixtures/storage";
import { signIn } from "../fixtures/infrastructure";
import { id } from "../fixtures/dashboard";
import { effectiveOptions, type PresentationDocument } from "../../lib/config/presentation";
import type { Overview, ReadResult } from "../../lib/monitoring/contracts";

async function fixture(page: Page) {
  const storage = await storageUiFixture(page), state = storage.admin;
  const model = JSON.parse(execFileSync(process.execPath, ["--conditions=react-server", "--input-type=module", "-e", "import{monitorFixture}from'./tests/fixtures/monitor-compat.mjs';process.stdout.write(JSON.stringify(monitorFixture({cardSize:'expanded'})));"], { encoding: "utf8", windowsHide: true })) as { document: PresentationDocument; overview: ReadResult<Overview> };
  model.document.screens = [model.document.screens[0]];
  state.document = model.document; state.document.rotation.autoStart = false; state.document.defaultTvMode = false; state.document.publicMonitorAutoScrollOnLoad = false;
  state.document.displayScalePercent = 100; state.document.dashboardZoomPercent = 70; state.document.publicMonitorZoomPercent = 70;
  const screen = state.document.screens[0], find = (type: string) => screen.blocks.find(block => block.type === type)!;
  find("storage_summary").options!.storageConfigId = storage.items[0].configId!;
  model.overview.data.blocks.find(block => block.type === "storage_summary")!.data = { target: storage.items[0] };
  screen.blocks.push({ id: id(8200), type: "problems", enabled: true, width: "wide", options: effectiveOptions({ type: "problems" }) });
  model.overview.data.blocks.push({ blockId: id(8200), type: "problems", availability: "ready", stale: false, lastUpdated: model.overview.lastUpdated, data: model.overview.data.problems });
  find("highlighted_resources").options = { ...find("highlighted_resources").options, rowMode: "manual", visibleRows: 3 };
  screen.overviewGrid = "split_custom";
  screen.overviewSlots = { topLeft: [find("highlighted_resources").id], topRight: [find("signal_flow").id, find("storage_summary").id], bottomLeft: [find("asgard_summary").id], bottomRight: [find("problems").id] };
  const aggregate = (screenId: string | null) => {
    const current = state.document.screens.find(screen => screen.id === screenId) ?? state.document.screens[0];
    return { ...model.overview, data: { ...model.overview.data, screenId: current.id, presentationRevision: state.document.revision, blocks: current.blocks.filter(block => block.enabled).map(block => ({ ...model.overview.data.blocks.find(item => item.blockId === block.id) ?? model.overview.data.blocks.find(item => item.type === block.type)!, blockId: block.id, options: block.options })) } };
  };
  for (const pattern of ["**/api/dashboard/overview*", "**/api/public/dashboard/overview*"]) await page.route(pattern, route => route.fulfill({ json: aggregate(new URL(route.request().url()).searchParams.get("screenId")) }));
  await page.route("**/api/public/settings/presentation", route => route.fulfill({ json: { data: state.document } }));
  return { state, screen, find, storage };
}

async function geometry(page: Page) {
  await expect.poll(() => page.locator("[data-slot-layout]").evaluate(root => {
    const rows = [...root.querySelectorAll<HTMLElement>(".slot-composition-row")];
    return rows.every((row, index) => {
      const box = row.getBoundingClientRect();
      if (index && box.top < rows[index - 1].getBoundingClientRect().bottom - 1) return false;
      return [...row.querySelectorAll<HTMLElement>(".slot-composition-group")].every(group => {
        const panels = [...group.querySelectorAll<HTMLElement>(".slot-panel")];
        return panels.every((panel, index) => {
          const bounds = panel.getBoundingClientRect(), content = panel.querySelector<HTMLElement>(".dashboard-panel")!;
          const heading = content.querySelector<HTMLElement>(".panel-heading")!, foot = content.querySelector<HTMLElement>(":scope > .panel-foot")!;
          return bounds.top >= box.top - 1 && bounds.bottom <= box.bottom + 1 && (!index || bounds.top >= panels[index - 1].getBoundingClientRect().bottom + 1) && foot.getBoundingClientRect().bottom <= content.getBoundingClientRect().bottom + 1 && foot.getBoundingClientRect().top > heading.getBoundingClientRect().bottom + 40;
        });
      });
    });
  })).toBe(true);
}

for (const route of ["/", "/monitor?compat=0"]) test(`custom slots fit their own panels and preserve zoom, card rows and mobile order: ${route}`, async ({ page }) => {
  test.setTimeout(90000);
  const { state, screen, find } = await fixture(page);
  await page.setViewportSize({ width: 1920, height: 1080 }); if (route === "/") await signIn(page);
  for (const size of ["compact", "expanded"] as const) for (const zoom of [70, 100, 125]) {
    find("highlighted_resources").options!.cardSize = size;
    state.document.dashboardZoomPercent = zoom; state.document.publicMonitorZoomPercent = zoom;
    await page.goto(route); await expect(page.locator("[data-overview-slot=topRight] > .slot-panel")).toHaveCount(2);
    await geometry(page);
    const group = page.locator("[data-overview-slot=topRight]");
    await expect(group.locator(".slot-panel").first()).toContainText("Signal · fluxo");
    const boxes = await group.locator(".slot-panel").evaluateAll(nodes => nodes.map(node => node.getBoundingClientRect().height));
    expect(Math.abs(boxes[0] - boxes[1])).toBeLessThan(1);
    const height = await page.locator(".availability-card").first().evaluate(node => node.getBoundingClientRect().height);
    expect(height).toBeCloseTo((size === "compact" ? 120 : 140) * zoom / 100, 0);
    await expect(page.locator(".dashboard-footer")).toBeInViewport();
  }
  find("signal_flow").enabled = false; await page.reload(); await expect(page.locator("[data-overview-slot=topRight]")).toHaveAttribute("data-panel-count", "1");
  await geometry(page);
  find("signal_flow").enabled = true; state.document.dashboardZoomPercent = 100; state.document.publicMonitorZoomPercent = 100;
  await page.setViewportSize({ width: 390, height: 844 }); await page.reload();
  const boxes = await page.locator(".slot-panel").evaluateAll(nodes => nodes.map(node => node.getBoundingClientRect().toJSON()));
  for (let index = 1; index < boxes.length; index++) expect(boxes[index].top).toBeGreaterThanOrEqual(boxes[index - 1].bottom - 1);
  await page.locator(".slot-panel").last().scrollIntoViewIfNeeded(); await expect(page.locator(".slot-panel").last()).toBeInViewport();
  expect(screen.overviewSlots!.topRight).toHaveLength(2); expect(state.writes).toHaveLength(0);
});

test("slot editor previews, saves independently, moves panel references and restores the current layout", async ({ page }) => {
  test.setTimeout(90000);
  const { state, screen, find, storage } = await fixture(page);
  const other = structuredClone(screen), remap = new Map(other.blocks.map((block, index) => [block.id, id(9100 + index)]));
  other.id = id(9001); other.name = "Outra tela";
  other.blocks.forEach(block => { block.id = remap.get(block.id)!; });
  for (const key of ["topLeft", "topRight", "bottomLeft", "bottomRight"] as const) other.overviewSlots![key] = other.overviewSlots![key].map(value => remap.get(value)!);
  other.overviewSlots!.topRight.reverse(); other.blocks.find(block => block.type === "summary")!.options!.fontScalePercent = 150;
  state.document.screens.push(other);
  await page.setViewportSize({ width: 1920, height: 1080 }); await signIn(page); await page.goto("/admin/configuracoes");
  const editor = page.getByRole("region", { name: "Tela 1", exact: true });
  const right = editor.getByRole("group", { name: "Superior direito", exact: true });
  await expect(right.getByLabel("Organização", { exact: true })).toHaveValue("pair");
  await right.getByRole("button", { name: "Inverter painéis", exact: true }).click();
  await editor.getByRole("button", { name: "Ver prévia", exact: true }).click();
  await expect(page.locator(".dashboard-preview [data-overview-slot=topRight] .slot-panel").first()).toContainText(storage.items[0].displayName);
  await page.getByRole("button", { name: "Salvar leitura do telão", exact: true }).click();
  await expect.poll(() => state.writes.length).toBe(1);
  expect(state.document.screens[0].overviewSlots!.topRight[0]).toBe(find("signal_flow").id);
  await page.getByRole("button", { name: "Salvar apresentação", exact: true }).click();
  await expect.poll(() => state.document.screens[0].overviewSlots!.topRight[0]).toBe(find("storage_summary").id);
  expect(state.document.screens[1].overviewSlots).toEqual(other.overviewSlots);
  await page.reload();
  await editor.getByLabel("Grade da visão geral", { exact: true }).selectOption("split");
  await page.getByRole("button", { name: "Salvar apresentação", exact: true }).click();
  await expect.poll(() => state.document.screens[0].overviewGrid).toBe("split");
  await editor.getByLabel("Grade da visão geral", { exact: true }).selectOption("split_custom");
  await expect(right.getByLabel("Painel superior", { exact: true })).toHaveValue(find("storage_summary").id);
  const lower = editor.getByRole("group", { name: "Inferior direito", exact: true });
  await lower.getByLabel("Painel", { exact: true }).selectOption(find("signal_flow").id);
  await expect(right.getByLabel("Organização", { exact: true })).toHaveValue("single");
  await expect(right.getByLabel("Painel", { exact: true })).toHaveValue(find("storage_summary").id);
  await expect(editor.getByText("Painéis sem posição", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Cancelar alterações", exact: true }).click();
  await expect(editor.getByLabel("Grade da visão geral", { exact: true })).toHaveValue("split");
  await editor.getByLabel("Grade da visão geral", { exact: true }).selectOption("split_custom");
  await editor.getByRole("article", { name: "Storage · capacidade e recursos na tela 1", exact: true }).getByRole("button", { name: "Remover bloco", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Remover bloco", exact: true }).click();
  await expect(right.getByLabel("Painel", { exact: true })).toHaveValue(find("signal_flow").id);
  await page.getByRole("button", { name: "Salvar apresentação", exact: true }).click();
  await expect.poll(() => state.document.screens[0].blocks.some(block => block.type === "storage_summary")).toBe(false);
  expect(state.document.screens[0].overviewSlots!.topRight).toEqual([find("signal_flow").id]);
});

for (const route of ["/", "/monitor?compat=0"]) test(`each screen renders its own slot order, card profile and KPI text scale: ${route}`, async ({ page }) => {
  const { state, screen, storage } = await fixture(page);
  const other = structuredClone(screen), remap = new Map(other.blocks.map((block, index) => [block.id, id(9200 + index)]));
  other.id = id(9209); other.name = "Tela alternativa";
  other.blocks.forEach(block => { block.id = remap.get(block.id)!; });
  for (const key of ["topLeft", "topRight", "bottomLeft", "bottomRight"] as const) other.overviewSlots![key] = other.overviewSlots![key].map(value => remap.get(value)!);
  other.overviewSlots!.topRight.reverse();
  other.blocks.find(block => block.type === "summary")!.options!.fontScalePercent = 150;
  Object.assign(other.blocks.find(block => block.type === "highlighted_resources")!.options!, { cardSize: "compact", visibleRows: 1 });
  state.document.screens.push(other);
  await page.setViewportSize({ width: 1920, height: 1080 }); if (route === "/") await signIn(page);
  await page.goto(route);
  let baselineFont = 0;
  for (const current of [screen, other, screen, other]) {
    await page.getByRole("combobox", { name: "Escolher tela", exact: true }).selectOption(current.id);
    const first = page.locator('[data-overview-slot=topRight] .slot-panel').first();
    await expect(first).toContainText(current === screen ? "Signal · fluxo" : storage.items[0].displayName);
    await expect(page.locator('.availability-panel')).toHaveAttribute('data-card-size',current === screen ? 'expanded' : 'compact');
    await expect(page.locator('.availability-panel')).toHaveAttribute('data-service-rows',current === screen ? '3' : '1');
    await expect(page.locator('.dashboard-kpis')).toHaveAttribute('data-kpi-font-scale',current === screen ? '100' : '150');
    const font = await page.locator('.kpi-value').first().evaluate(node => parseFloat(getComputedStyle(node).fontSize));
    if (!baselineFont) baselineFont = font;
    expect(font).toBeCloseTo(baselineFont * (current === screen ? 1 : 1.5), 0);
    const cardHeight = await page.locator('.availability-card').first().evaluate(node => node.getBoundingClientRect().height);
    expect(cardHeight).toBeCloseTo((current === screen ? 140 : 120) * 0.7, 0);
    await geometry(page);
  }
  await page.reload();
  await expect(page.locator('[data-slot-layout]')).toBeVisible();
  expect(state.writes).toHaveLength(0);
});

test("custom stacks keep private TV scale proportional and empty rows do not reserve space", async ({ page }) => {
  const { state, screen, find } = await fixture(page);
  state.document.displayScalePercent = 125;
  find("highlighted_resources").options!.rowMode = "auto";
  await page.setViewportSize({ width: 1366, height: 768 }); await signIn(page);
  await page.getByRole("button", { name: "Modo TV", exact: true }).click();
  await expect(page.locator(".dashboard-shell")).toHaveAttribute("data-display-scale", "125");
  await expect(page.locator(".availability-panel")).toHaveAttribute("data-service-rows", "2");
  expect(await page.locator(".availability-card").first().evaluate(node => node.getBoundingClientRect().height)).toBeCloseTo(140 * 1.25 * 0.7, 0);
  await geometry(page);
  find("summary").enabled = false; await page.reload();
  await expect(page.locator(".availability-panel")).toHaveAttribute("data-service-rows", "3");
  await geometry(page);
  find("highlighted_resources").enabled = false;
  screen.overviewSlots!.topLeft = [find("asgard_summary").id, find("problems").id];
  screen.overviewSlots!.bottomLeft = []; screen.overviewSlots!.bottomRight = [];
  await page.reload();
  await expect(page.locator(".slot-composition-row")).toHaveCount(1);
  await expect(page.locator("[data-overview-slot=topLeft]")).toHaveAttribute("data-panel-count", "2");
  await geometry(page);
  const bottom = await page.locator(".slot-composition-row").evaluate(node => node.getBoundingClientRect().bottom);
  expect(bottom).toBeGreaterThan(700);
  await expect(page.locator(".dashboard-footer")).toBeInViewport();
});
