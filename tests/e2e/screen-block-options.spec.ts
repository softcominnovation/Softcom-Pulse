import { test, expect, type Page } from "@playwright/test";
import { storageUiFixture } from "../fixtures/storage";
import { signIn } from "../fixtures/infrastructure";
import { id, overview } from "../fixtures/dashboard";
import { effectiveOptions } from "../../lib/config/presentation";
import { notificationFixture, addNotification } from "../fixtures/notifications";
import { pulseAlertTabIcon, pulseTabIcon } from "../../lib/notifications/tab-icon";

const profiles = [
  { name: "Operação", size: "compact", scale: 100, rows: 1 },
  { name: "Capacidade", size: "expanded", scale: 150, rows: 2 },
  { name: "Plantão", size: "expanded", scale: 125, rows: 3 },
] as const;

async function fixture(page: Page, payloadOptions = true) {
  const state = await storageUiFixture(page), admin = state.admin;
  const base = structuredClone(admin.document.screens[0]);
  admin.document.defaultTvMode = false; admin.document.displayScalePercent = 100;
  admin.document.dashboardZoomPercent = 80; admin.document.publicMonitorZoomPercent = 70;
  admin.document.publicMonitorAutoScrollOnLoad = false;
  admin.document.screens = profiles.map((profile, index) => {
    const screen = { ...structuredClone(base), id: id(9500 + index), name: profile.name };
    screen.overviewGrid = index === 0 ? "split" : "default";
    screen.blocks.forEach((block, position) => {
      block.id = id(9600 + index * 20 + position);
      if (block.type === "summary") block.options = { indicators: ["hosts", "problems"], fontScalePercent: profile.scale };
      if (block.type === "highlighted_resources") block.options = { ...effectiveOptions(block), cardSize: profile.size, rowMode: "manual", visibleRows: profile.rows };
    });
    // Include the composition used by the real additional screen, without sharing block IDs.
    if (index === 1) screen.blocks.push({ id: id(9700), type: "storage_summary", width: "wide", enabled: true, options: { storageConfigId: state.configs[0].id, visibleRows: 3 } });
    return screen;
  });
  const respond = (url: string) => {
    const result = overview(admin.document, new URL(url).searchParams.get("screenId") ?? undefined);
    const screen = admin.document.screens.find(item => item.id === result.data.screenId)!;
    for (const block of result.data.blocks) {
      if (payloadOptions) block.options = screen.blocks.find(item => item.id === block.blockId)?.options;
      if (block.type === "storage_summary") block.data = { target: state.items[0] };
    }
    return result;
  };
  await page.route("**/api/dashboard/overview*", route => route.fulfill({ json: respond(route.request().url()) }));
  await page.route("**/api/public/dashboard/overview*", route => route.fulfill({ json: respond(route.request().url()) }));
  await page.route("**/api/public/settings/presentation", route => route.fulfill({ json: { data: admin.document } }));
  return { ...state, respond };
}

async function assertScreen(page: Page, index: number, zoom: number) {
  const profile = profiles[index], band = page.locator(".dashboard-kpis"), panel = page.locator(".availability-panel");
  await expect(band).toHaveAttribute("data-kpi-font-scale", String(profile.scale));
  await expect(panel).toHaveAttribute("data-card-size", profile.size);
  await expect(panel).toHaveAttribute("data-service-rows", String(profile.rows));
  const card = panel.locator(".availability-card").first();
  await expect.poll(() => card.evaluate(node => node.getBoundingClientRect().height)).toBeCloseTo(((profile.size === "expanded" ? 140 : 120) + (new URL(page.url()).pathname === "/monitor" ? 28 : 0)) * zoom / 100, 0);
  expect(await band.locator(".kpi-value").first().evaluate(node => parseFloat(getComputedStyle(node).fontSize))).toBeGreaterThan(0);
  await expect(page.locator("[data-block-id]")).toHaveCount(index === 1 ? 5 : 4);
}

for (const route of ["/", "/monitor?compat=0"]) for (const payloadOptions of [true, false]) test(`three screens preserve their block options across switches, reload and cache: ${route}, payload options=${payloadOptions}`, async ({ page }) => {
  const state = await fixture(page, payloadOptions);
  await page.setViewportSize({ width: 1920, height: 1080 });
  if (route === "/") await signIn(page);
  await page.goto(route);
  const zoom = route === "/" ? 80 : 70;
  const fonts: number[] = [];
  for (const index of [0, 1, 2, 1, 0, 2]) {
    await page.getByRole("combobox", { name: "Escolher tela", exact: true }).selectOption(state.admin.document.screens[index].id);
    await assertScreen(page, index, zoom);
    const font = await page.locator(".kpi-value").first().evaluate(node => parseFloat(getComputedStyle(node).fontSize));
    if (fonts[index]) expect(font).toBeCloseTo(fonts[index], 1);
    fonts[index] = font;
  }
  expect(fonts[1] / fonts[2]).toBeCloseTo(150 / 125, 1);
  await page.reload(); await assertScreen(page, 0, zoom);
  await page.getByRole("combobox", { name: "Escolher tela", exact: true }).selectOption(state.admin.document.screens[1].id);
  await assertScreen(page, 1, zoom);
  expect(state.admin.writes).toHaveLength(0);
});

test("editing and reordering three screens preserves each block through previews, reading saves and playback", async ({ page }) => {
  const state = await fixture(page), before = structuredClone(state.admin.document);
  await page.setViewportSize({ width: 1920, height: 1080 }); await signIn(page); await page.goto("/admin/configuracoes");
  const second = page.getByRole("region", { name: "Tela 2", exact: true });
  const third = page.getByRole("region", { name: "Tela 3", exact: true });
  await second.getByLabel("Tamanho dos minicards", { exact: true }).selectOption("compact");
  await second.getByLabel("Tamanho dos textos dos KPIs", { exact: true }).selectOption("110");
  await third.getByLabel("Tamanho dos minicards", { exact: true }).selectOption("compact");
  await third.getByLabel("Tamanho dos textos dos KPIs", { exact: true }).selectOption("150");
  await second.getByRole("button", { name: "Ver prévia", exact: true }).click();
  const preview = page.locator(".dashboard-preview");
  await expect(preview.locator(".availability-panel")).toHaveAttribute("data-card-size", "compact");
  await expect(preview.locator(".dashboard-kpis")).toHaveAttribute("data-kpi-font-scale", "110");
  await third.getByRole("button", { name: "Ver prévia", exact: true }).click();
  await expect(preview.locator(".dashboard-kpis")).toHaveAttribute("data-kpi-font-scale", "150");
  await page.getByRole("button", { name: "Salvar leitura do telão", exact: true }).click();
  await expect.poll(() => state.admin.writes.length).toBe(1);
  expect(state.admin.document.screens).toEqual(before.screens);
  await page.getByRole("button", { name: "Salvar apresentação", exact: true }).click();
  await expect.poll(() => state.admin.document.screens[1].blocks.find(block => block.type === "summary")!.options!.fontScalePercent).toBe(110);
  expect(state.admin.document.screens[0]).toEqual(before.screens[0]);
  await page.reload();
  await expect(second.getByLabel("Tamanho dos minicards", { exact: true })).toHaveValue("compact");
  await expect(third.getByLabel("Tamanho dos textos dos KPIs", { exact: true })).toHaveValue("150");
  await page.getByRole("button", { name: "Mover tela 3 para cima", exact: true }).click();
  await page.getByRole("button", { name: "Salvar apresentação", exact: true }).click();
  await expect.poll(() => state.admin.document.screens[1].name).toBe("Plantão");
  await page.goto("/");
  for (const screen of state.admin.document.screens) {
    await page.getByRole("combobox", { name: "Escolher tela", exact: true }).selectOption(screen.id);
    await expect(page.locator(".dashboard-kpis")).toHaveAttribute("data-kpi-font-scale", String(screen.blocks.find(block => block.type === "summary")!.options!.fontScalePercent));
    await expect(page.locator(".availability-panel")).toHaveAttribute("data-card-size", String(screen.blocks.find(block => block.type === "highlighted_resources")!.options!.cardSize));
  }
  expect(state.admin.document.dashboardZoomPercent).toBe(80); expect(state.admin.document.publicMonitorZoomPercent).toBe(70);
});

test("saving through app navigation updates a previously paused root dashboard", async ({ page }) => {
  const state = await fixture(page);
  state.admin.document.rotation = { autoStart: true, intervalSeconds: 300 };
  await page.setViewportSize({ width: 1920, height: 1080 }); await signIn(page);
  await page.getByRole("combobox", { name: "Escolher tela", exact: true }).selectOption(state.admin.document.screens[1].id);
  await expect(page.locator(".dashboard-kpis")).toHaveAttribute("data-kpi-font-scale", "150");
  await page.getByRole("link", { name: "Configurações", exact: true }).click();
  const second = page.getByRole("region", { name: "Tela 2", exact: true });
  await second.getByLabel("Tamanho dos textos dos KPIs", { exact: true }).selectOption("110");
  await second.getByLabel("Tamanho dos minicards", { exact: true }).selectOption("compact");
  await page.getByRole("button", { name: "Salvar apresentação", exact: true }).click();
  await expect.poll(() => state.admin.document.screens[1].blocks.find(block => block.type === "summary")!.options!.fontScalePercent).toBe(110);
  await page.getByRole("link", { name: "Visão geral", exact: true }).click();
  await page.getByRole("combobox", { name: "Escolher tela", exact: true }).selectOption(state.admin.document.screens[1].id);
  await expect(page.locator(".dashboard-kpis")).toHaveAttribute("data-kpi-font-scale", "110");
  await expect(page.locator(".availability-panel")).toHaveAttribute("data-card-size", "compact");
});

for (const route of ["/", "/monitor?compat=0"]) test(`manual screen selection applies settings received while rotation is paused: ${route}`, async ({ page }) => {
  const state = await fixture(page);
  state.admin.document.rotation = { autoStart: true, intervalSeconds: 300 };
  await page.setViewportSize({ width: 1920, height: 1080 });
  if (route === "/") await signIn(page);
  await page.goto(route);
  await page.getByRole("combobox", { name: "Escolher tela", exact: true }).selectOption(state.admin.document.screens[1].id);
  await expect(page.locator(".dashboard-kpis")).toHaveAttribute("data-kpi-font-scale", "150");
  const blocks = state.admin.document.screens[1].blocks;
  blocks.find(block => block.type === "summary")!.options!.fontScalePercent = 110;
  blocks.find(block => block.type === "highlighted_resources")!.options!.cardSize = "compact";
  state.admin.document.revision++;
  await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
  await expect(page.locator(".configuration-notice")).toContainText("Configuração atualizada");
  await page.getByRole("combobox", { name: "Escolher tela", exact: true }).selectOption(state.admin.document.screens[2].id);
  await page.getByRole("combobox", { name: "Escolher tela", exact: true }).selectOption(state.admin.document.screens[1].id);
  await expect(page.locator(".dashboard-kpis")).toHaveAttribute("data-kpi-font-scale", "110");
  await expect(page.locator(".availability-panel")).toHaveAttribute("data-card-size", "compact");
  await expect(page.getByRole("button", { name: "Continuar alternância", exact: true })).toBeVisible();
});

for (const route of ["/", "/monitor?compat=0"]) for (const navigationDelayMs of [0, 6000]) test(`unread notifications survive background and client navigation without breaking screen options: ${route}${navigationDelayMs ? ' (slow navigation)' : ''}`, async ({ page }) => {
  const state = await fixture(page), notifications = await notificationFixture(page);
  let navigationRequested = false;
  if (navigationDelayMs) await page.route(url => url.pathname === (route === '/' ? '/servicos' : '/monitor/servicos'), async request => {
    if (request.request().headers()['rsc'] !== '1' || request.request().headers()['next-router-prefetch'] === '1') return request.continue();
    navigationRequested = true;
    await new Promise(resolve => setTimeout(resolve, navigationDelayMs));
    return request.continue();
  });
  addNotification(notifications);
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.stack ?? error.message));
  await page.setViewportSize({ width: 1920, height: 1080 });
  if (route === "/") await signIn(page);
  await page.goto(route);
  await expect(page.getByRole("button", { name: /^Notificações: 1 não lidas/ })).toBeVisible();
  const originalIcons = await page.locator('link[rel="icon"]').elementHandles();
  expect(originalIcons.length).toBeGreaterThan(0);
  for (const hidden of [true, false, true, false]) {
    await page.evaluate(hidden => {
      Object.defineProperty(document, "hidden", { configurable: true, value: hidden });
      document.dispatchEvent(new Event("visibilitychange"));
    }, hidden);
    await expect(page.locator('link[rel="icon"]').first()).toHaveAttribute("href", hidden ? pulseAlertTabIcon : pulseTabIcon);
  }
  const retainedIcons = await Promise.all(originalIcons.map(icon => icon.evaluate(node => node.isConnected)));
  const servicesPath = route === '/' ? '/servicos' : '/monitor/servicos';
  const servicesLink = page.getByRole("link", { name: "Serviços", exact: true });
  await expect(servicesLink).toHaveAttribute('href', servicesPath);
  // Next client navigation may await a cold route compilation. Wait for the
  // navigation itself before checking its result, as in the VPS detail test.
  await Promise.all([page.waitForURL(url => url.pathname === servicesPath), servicesLink.click()]);
  await expect(page).toHaveURL(route === "/" ? /\/servicos$/ : /\/monitor\/servicos$/);
  if (navigationDelayMs) expect(navigationRequested).toBe(true);
  await Promise.all([page.waitForURL(url => url.pathname === (route === '/' ? '/' : '/monitor')), page.getByRole("link", { name: "Visão geral", exact: true }).click()]);
  await page.locator(".availability-panel").waitFor();
  expect(errors).toEqual([]);
  expect(retainedIcons.every(Boolean)).toBe(true);
  await page.getByRole("combobox", { name: "Escolher tela", exact: true }).selectOption(state.admin.document.screens[1].id);
  await assertScreen(page, 1, route === "/" ? 80 : 70);
  const enlargedFont = await page.locator(".kpi-value").first().evaluate(node => parseFloat(getComputedStyle(node).fontSize));
  const screen = state.admin.document.screens[1];
  screen.blocks.find(block => block.type === "summary")!.options!.fontScalePercent = 100;
  screen.blocks.find(block => block.type === "highlighted_resources")!.options!.cardSize = "compact";
  state.admin.document.revision++;
  await page.evaluate(() => window.dispatchEvent(new Event("pulse:preferences-changed")));
  // A manually selected screen keeps reading paused until an explicit boundary.
  await expect(page.getByRole("button", { name: "Aplicar configuração atualizada", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Aplicar configuração atualizada", exact: true }).click();
  await expect(page.locator(".dashboard-kpis")).toHaveAttribute("data-kpi-font-scale", "100");
  await expect(page.locator(".availability-panel")).toHaveAttribute("data-card-size", "compact");
  const font = await page.locator(".kpi-value").first().evaluate(node => parseFloat(getComputedStyle(node).fontSize));
  expect(enlargedFont / font).toBeCloseTo(1.5, 1);
  expect((await page.locator(".availability-card").first().boundingBox())!.height).toBeCloseTo((route === "/" ? 120 * .8 : 148 * .7), 0);
  screen.blocks.find(block => block.type === "summary")!.options!.fontScalePercent = 150;
  screen.blocks.find(block => block.type === "highlighted_resources")!.options!.cardSize = "expanded";
  state.admin.document.revision++;
  await page.evaluate(() => window.dispatchEvent(new Event("pulse:preferences-changed")));
  // Applying the previous revision stopped the non-rotating player, so this
  // update is now applied immediately instead of waiting for another boundary.
  await assertScreen(page, 1, route === "/" ? 80 : 70);
  expect(await page.locator(".kpi-value").first().evaluate(node => parseFloat(getComputedStyle(node).fontSize))).toBeCloseTo(enlargedFont, 1);
  expect(errors).toEqual([]);
});
