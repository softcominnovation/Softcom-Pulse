import { test, expect } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { servicesFixture } from "../fixtures/services";
import { signIn } from "../fixtures/infrastructure";
import { overview, presentation } from "../fixtures/dashboard";

test("services use aggregated discovery and show all container and health states with separate hosts", async ({ page }) => {
  const state = await servicesFixture(page);
  state.infrastructure.problems = ([0, 1, 2, 3, 4, 5] as const).map(severity => ({ ...state.infrastructure.problems[0], id: `severity-${severity}`, severity }));
  await signIn(page); await page.goto("/servicos");
  await expect(page.getByRole("heading", { name: "Inventário de containers" })).toBeVisible();
  const configuredPanel = page.locator("section").filter({ has: page.getByRole("heading", { name: "Recursos configurados", exact: true }) });
  const panelBox = await configuredPanel.boundingBox();
  const noticeBox = await configuredPanel.locator(".dashboard-banner").boundingBox();
  const cardBox = await configuredPanel.locator(".resource-card").first().boundingBox();
  expect(noticeBox!.x).toBeGreaterThanOrEqual(panelBox!.x + 12);
  expect(noticeBox!.x + noticeBox!.width).toBeLessThanOrEqual(panelBox!.x + panelBox!.width - 12);
  expect(cardBox!.width).toBeGreaterThan(230);
  expect(cardBox!.width).toBeLessThanOrEqual(360.5);
  expect(cardBox!.y).toBeGreaterThanOrEqual(noticeBox!.y + noticeBox!.height + 12);
  const first = page.getByRole("region", { name: "Lista de containers de linux-operacao", exact: true });
  await expect(first.locator("tbody tr")).toHaveCount(8);
  for (const value of ["Em execução", "Parado", "Pausado", "Reiniciando", "Criado", "Em remoção", "Encerrado com falha", "Sem estado atual", "Sem healthcheck", "Saudável", "Iniciando", "Falha no healthcheck", "Métrica de health não suportada"]) await expect(first.getByText(value, { exact: true }).first()).toBeVisible();
  const stopped = first.getByRole("row").filter({ has: page.getByText("container-stopped", { exact: true }) });
  await expect(stopped.getByText("Parado", { exact: true })).toHaveClass(/tone-bad/);
  await expect(stopped.getByText("Saudável", { exact: true })).toBeVisible();
  const other = page.getByRole("region", { name: "Lista de containers de another-agent", exact: true });
  await expect(other).toContainText("only-other-host:1"); await expect(first).not.toContainText("only-other-host:1");
  await first.locator("summary").first().click(); await expect(first.locator("details[open]").getByText("1 Mbit/s", { exact: true })).toBeVisible();
  expect(state.requests.filter(path => /\/hosts\/.*\/containers/.test(path))).toHaveLength(0);
  expect(state.historyCalls).toHaveLength(0);
  await expect(page.getByText("Mais de um recurso corresponde ao seletor", { exact: true })).toBeVisible();
  await expect(page.locator(".detail-problems .status-pill")).toHaveText(["Desastre", "Alta", "Média", "Atenção", "Informação", "Não classificado"]);
});

test("configured detail respects preferences and loads numeric history and accessible discrete timelines only on demand", async ({ page }) => {
  const state = await servicesFixture(page); await signIn(page); await page.goto("/servicos");
  expect(state.historyCalls).toHaveLength(0);
  await page.getByRole("button", { name: "Detalhes de Serviço 0", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("region", { name: "Histórico de Healthcheck", exact: true })).toBeVisible();
  await expect.poll(() => state.historyCalls.length).toBe(1);
  await expect(dialog.locator(".uplot")).toBeVisible();
  await mkdir(".cache/screenshots", { recursive: true }); await page.screenshot({ path: ".cache/screenshots/service-history.png" });
  const health = dialog.getByRole("region", { name: "Histórico de Healthcheck", exact: true });
  await dialog.locator(".service-history-heading").evaluate(element => element.scrollIntoView({ block: "start" }));
  await page.screenshot({ path: ".cache/screenshots/service-numeric-history.png" });
  await health.evaluate(element => element.scrollIntoView({ block: "start" }));
  await page.screenshot({ path: ".cache/screenshots/service-state-history.png" });
  await health.getByRole("slider").focus(); await page.keyboard.press("ArrowRight"); await expect(health).toContainText("Sem evidência neste intervalo");
  await expect(dialog.getByRole("region", { name: "Histórico de Estado do container" }).locator("rect")).toHaveClass(/timeline-bad/);
  await dialog.getByRole("button", { name: "24 horas", exact: true }).click(); await expect.poll(() => state.historyCalls.length).toBe(2);
  await page.clock.install(); await page.clock.runFor(61000); expect(state.historyCalls).toHaveLength(2);
  await page.keyboard.press("Escape"); await expect(dialog).toHaveCount(0); await expect(page.getByRole("button", { name: "Detalhes de Serviço 0", exact: true })).toBeFocused();
  state.services[0].config.presentation = { showStatus: false, showCpu: false, showMemory: false, showDisk: false, showNetwork: false, showUptime: false, showHealth: false, showHealthTimeline: false };
  await page.getByRole("button", { name: "Atualizar serviços configurados" }).click();
  const card = page.locator(".resource-card").filter({ has: page.getByRole("heading", { name: "Serviço 0", exact: true }) });
  await expect(card.getByText("Saudável", { exact: true })).toHaveCount(0);
  await card.getByRole("button", { name: "Detalhes de Serviço 0" }).click();
  await expect(page.getByRole("dialog").getByText("Nome técnico", { exact: true })).toBeVisible();
  await expect(page.getByRole("dialog").getByRole("region", { name: "Histórico do recurso" })).toHaveCount(0);
  await expect(page.getByRole("dialog").getByText("Saudável", { exact: true })).toHaveCount(0); expect(state.historyCalls).toHaveLength(2);
});

test("VM actions preserve navigation, scope results, keep expansions on refresh and restore focus", async ({ page }) => {
  const state = await servicesFixture(page); await signIn(page); await page.goto("/asgard?hostKey=ASGARD&vm=vm-0");
  const button = page.getByRole("button", { name: `Serviços e containers de ${state.infrastructure.hosts[0].vms[0].name}`, exact: true });
  const url = page.url(); expect(state.workloadCalls).toHaveLength(0);
  await button.click(); const dialog = page.getByRole("dialog");
  await expect(dialog.locator("tbody tr")).toHaveCount(8); expect(page.url()).toBe(url);
  await expect(dialog).not.toContainText("only-other-host:1");
  await expect(dialog).toContainText("Serviço 2 · Desabilitado"); await expect(dialog).toContainText("Mais de um recurso corresponde ao seletor");
  await dialog.locator(".container-extra summary").first().click();
  await dialog.getByRole("button", { name: "Atualizar serviços e containers da VM" }).click();
  await expect.poll(() => state.workloadCalls.length).toBe(2); await expect(dialog.locator(".container-extra").first()).toHaveAttribute("open", "");
  state.fail = true; await dialog.getByRole("button", { name: "Atualizar serviços e containers da VM" }).click();
  await expect(dialog.getByText("Falha na atualização", { exact: true })).toBeVisible(); await expect(dialog.locator("tbody tr")).toHaveCount(8);
  await page.keyboard.press("Escape"); await expect(button).toBeFocused();
  state.fail = false; await page.getByRole("button", { name: "Serviços e containers de vm-operacao-1", exact: true }).click();
  await expect(page.getByRole("dialog")).toContainText("only-other-host:1"); await expect(page.getByRole("dialog").locator("tbody tr")).toHaveCount(1);
  expect(page.url()).toBe(url); expect(state.historyCalls).toHaveLength(0);
});

test("VM empty states distinguish no link, missing host, no Docker snapshot and known empty discovery", async ({ page }) => {
  const state = await servicesFixture(page); await signIn(page); await page.goto("/asgard?hostKey=ASGARD");
  const name = `Serviços e containers de ${state.infrastructure.hosts[0].vms[0].name}`;
  for (const [mode, message] of [["unlinked", "Sem host monitorado associado"], ["host_unavailable", "O host associado está indisponível"], ["no_data", "Sem inventário de containers disponível"], ["empty", "Nenhum container individualizado"]]) {
    state.mode = mode; await page.getByRole("button", { name, exact: true }).click();
    await expect(page.getByRole("dialog")).toContainText(message); await page.keyboard.press("Escape");
  }
  state.mode = "auto"; state.mismatch = true; await page.getByRole("button", { name, exact: true }).click();
  await expect(page.getByRole("dialog")).toContainText("Falha na atualização"); await expect(page.getByRole("dialog").locator("tbody tr")).toHaveCount(0);
});

test("closing a pending VM request cannot paint a different VM or keep polling", async ({ page }) => {
  const state = await servicesFixture(page); await signIn(page); await page.goto("/asgard?hostKey=ASGARD");
  let release!: () => void; state.wait = new Promise(resolve => { release = resolve; });
  await page.getByRole("button", { name: `Serviços e containers de ${state.infrastructure.hosts[0].vms[0].name}`, exact: true }).click();
  await expect.poll(() => state.workloadCalls.length).toBe(1); await page.keyboard.press("Escape");
  state.wait = null; await page.getByRole("button", { name: "Serviços e containers de vm-operacao-1", exact: true }).click();
  await expect(page.getByRole("dialog")).toContainText("only-other-host:1"); release();
  await expect(page.getByRole("dialog").locator("tbody tr")).toHaveCount(1);
  await page.keyboard.press("Escape"); await page.clock.install(); await page.clock.runFor(120000); expect(state.workloadCalls).toHaveLength(2);
});

test("VM polling pauses hidden, resumes visible, and contains focus until its trigger disappears", async ({ page }) => {
  const state = await servicesFixture(page); state.pollMs = 1000; await signIn(page); await page.goto("/asgard?hostKey=ASGARD");
  await page.clock.install();
  await page.getByRole("button", { name: "Serviços e containers de vm-operacao-1", exact: true }).click();
  await expect.poll(() => state.workloadCalls.length).toBe(1);
  await page.evaluate(() => { Object.defineProperty(document, "hidden", { configurable: true, value: true }); document.dispatchEvent(new Event("visibilitychange")); });
  await page.clock.runFor(5000); expect(state.workloadCalls).toHaveLength(1);
  await page.evaluate(() => { Object.defineProperty(document, "hidden", { configurable: true, value: false }); document.dispatchEvent(new Event("visibilitychange")); });
  await expect.poll(() => state.workloadCalls.length).toBe(2);
  for (let n = 0; n < 10; n++) { await page.keyboard.press("Tab"); expect(await page.evaluate(() => !!document.activeElement?.closest('[role="dialog"]'))).toBe(true); }
  state.infrastructure.hosts[0].vms = state.infrastructure.hosts[0].vms.filter(vm => vm.vmKey !== "vm-1");
  await page.clock.runFor(61000); await expect(page.getByRole("button", { name: "Serviços e containers de vm-operacao-1", exact: true })).toHaveCount(0);
  await page.keyboard.press("Escape"); await expect(page.getByRole("region", { name: "Máquinas virtuais do hipervisor", exact: true })).toBeFocused();
});

test("container-only screen is playable and service detail from dashboard has no background history requests", async ({ page }) => {
  const state = await servicesFixture(page), document = presentation(2), root = overview(document);
  document.screens[1].blocks = [{ ...document.screens[1].blocks[0], type: "container_inventory" }];
  await page.route("**/api/settings/presentation", route => route.fulfill({ json: { data: document, updatedAt: root.lastUpdated } }));
  await page.route("**/api/dashboard/overview?*", route => {
    const screenId = new URL(route.request().url()).searchParams.get("screenId")!, body = overview(document, screenId);
    if (screenId === document.screens[1].id) body.data.blocks = [{ blockId: document.screens[1].blocks[0].id, type: "container_inventory", data: state.containers, availability: "ready", stale: false, lastUpdated: body.lastUpdated }];
    else { body.data.highlightedResources = [state.services[0]]; body.data.blocks.find(block => block.type === "highlighted_resources")!.data = [state.services[0]]; }
    return route.fulfill({ json: body });
  });
  await signIn(page); await page.getByRole("button", { name: /^Detalhes de Serviço 0:/ }).click();
  await expect(page.getByRole("dialog").locator(".uplot")).toBeVisible(); expect(state.historyCalls).toHaveLength(1);
  await page.keyboard.press("Escape"); await page.getByLabel("Escolher tela").selectOption(document.screens[1].id);
  await expect(page.getByRole("heading", { name: "Containers descobertos", exact: true })).toBeVisible();
  await page.clock.install(); await page.clock.runFor(61000); expect(state.historyCalls).toHaveLength(1);
  expect(state.requests.filter(path => path === "/api/monitoring/containers")).toHaveLength(0);
});

test("touch and zoom keep VM and service dialogs usable with reachable close and graph controls", async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true });
  const page = await context.newPage(); const state = await servicesFixture(page); await signIn(page); await page.goto("/asgard?hostKey=ASGARD");
  const button = page.getByRole("button", { name: `Serviços e containers de ${state.infrastructure.hosts[0].vms[0].name}`, exact: true });
  expect((await button.boundingBox())!.height).toBeGreaterThanOrEqual(44); await button.tap();
  let dialog = page.getByRole("dialog"); await expect(dialog.locator("tbody tr")).toHaveCount(8);
  await expect(dialog.locator("summary").first()).toHaveCSS("min-height", "44px");
  await dialog.getByRole("button", { name: "Fechar diálogo" }).tap(); await page.goto("/servicos");
  await page.getByRole("button", { name: "Detalhes de Serviço 0", exact: true }).tap(); dialog = page.getByRole("dialog");
  await expect(dialog.locator(".uplot")).toBeVisible();
  await dialog.getByRole("button", { name: "7 dias", exact: true }).tap(); await expect.poll(() => state.historyCalls.length).toBe(2);
  await page.setViewportSize({ width: 1366, height: 768 }); await page.evaluate(() => { document.documentElement.style.zoom = "2"; });
  const close = dialog.getByRole("button", { name: "Fechar diálogo" });
  const box = await close.boundingBox(); expect(box!.x + box!.width).toBeLessThanOrEqual(1367); expect(box!.y + box!.height).toBeLessThanOrEqual(769);
  await close.tap(); await expect(dialog).toHaveCount(0); await context.close();
});

test("services route requires a session and VM modal cancels on logout", async ({ page }) => {
  const state = await servicesFixture(page); await page.goto("/servicos"); await expect(page).toHaveURL(/\/login/);
  await signIn(page); await page.goto("/asgard?hostKey=ASGARD");
  await page.getByRole("button", { name: "Serviços e containers de vm-operacao-1", exact: true }).click();
  await expect(page.getByRole("dialog").locator("tbody tr")).toHaveCount(1);
  await page.evaluate(() => { localStorage.clear(); window.dispatchEvent(new StorageEvent("storage", { key: null })); });
  await expect(page).toHaveURL(/\/login/); await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.clock.install(); await page.clock.runFor(61000); expect(state.workloadCalls).toHaveLength(1);
});

for (const [width, height] of [[320,568],[360,800],[390,844],[768,1024],[1024,768],[1366,768],[1920,1080],[844,390]]) {
  test(`services and VM modal retain fields, actions and scroll at ${width}x${height}`, async ({ page }) => {
    await page.setViewportSize({ width, height }); const state = await servicesFixture(page); await signIn(page); await page.goto("/servicos");
    await expect(page.locator(".container-table tbody tr")).toHaveCount(9);
    console.log(await page.evaluate(() => [...document.querySelectorAll("main *")].filter(node => node.getBoundingClientRect().right > innerWidth).slice(0, 8).map(node => [node.className, node.getBoundingClientRect().width, getComputedStyle(node).overflowX])));
    if (width === 390) await page.screenshot({ path: ".cache/services-overflow.png", fullPage: true });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), await page.evaluate(() => [...document.querySelectorAll("main *")].filter(node => node.getBoundingClientRect().right > innerWidth && !node.closest(".container-table-scroll")).slice(0, 10).map(node => [node.className, node.getBoundingClientRect().width]))).toBe(true);
    if (width === 1366 || width === 390) { await mkdir(".cache/screenshots", { recursive: true }); await page.screenshot({ path: `.cache/screenshots/services-${width}.png`, fullPage: true }); }
    await page.goto("/asgard?hostKey=ASGARD");
    await page.getByRole("button", { name: `Serviços e containers de ${state.infrastructure.hosts[0].vms[0].name}`, exact: true }).click();
    const dialog = page.getByRole("dialog"); await expect(dialog.locator("tbody tr")).toHaveCount(8);
    const box = await dialog.boundingBox(); expect(box!.x).toBeGreaterThanOrEqual(0); expect(box!.y).toBeGreaterThanOrEqual(0); expect(box!.x + box!.width).toBeLessThanOrEqual(width + 1); expect(box!.y + box!.height).toBeLessThanOrEqual(height + 1);
    await expect(dialog.getByRole("button", { name: "Fechar diálogo" })).toBeVisible();
    if (width === 1366 || width === 390) await page.screenshot({ path: `.cache/screenshots/workloads-${width}.png` });
    await page.keyboard.press("Escape"); await expect(dialog).toHaveCount(0);
  });
}
