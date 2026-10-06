import { test, expect, type Page } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { presentation, overview, id } from "../fixtures/dashboard";
import type { ConfiguredResource, Container } from "../../lib/monitoring/contracts";

async function enter(page: Page) {
  await page.goto("/login");
  await page.getByLabel("E-mail", { exact: true }).fill("dashboard@example.test");
  await page.getByLabel("Senha", { exact: true }).fill("test-password");
  await page.getByRole("button", { name: "Entrar", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Dashboard", exact: true })).toBeVisible();
}
async function mock(page: Page, count = 1, autoStart = false) {
  const state = { document: presentation(count, 1, autoStart), fail: false, configFail: false, stale: false, empty: false, calls: [] as string[], delay: 0, transform: null as ((body: ReturnType<typeof overview>) => void) | null };
  await page.route("**/api/settings/presentation", route => state.configFail ? route.fulfill({ status: 503, json: { error: "unavailable" } }) : route.fulfill({ json: { data: state.document, updatedAt: new Date().toISOString() } }));
  await page.route("**/api/dashboard/overview?*", async route => {
    const screenId = new URL(route.request().url()).searchParams.get("screenId")!;
    state.calls.push(screenId);
    const body = overview(state.document, screenId, state.stale);
    if (state.empty) { body.data.highlightedResources = []; const block = body.data.blocks.find(block => block.type === "highlighted_resources")!; block.data = []; }
    state.transform?.(body);
    if (state.delay) await new Promise(resolve => setTimeout(resolve, state.delay));
    await route.fulfill(state.fail ? { status: 503, json: { error: "unavailable" } } : { json: body });
  });
  return state;
}
for (const [width, height] of [[320,568],[360,800],[390,844],[768,1024],[1024,768],[1366,768],[1920,1080],[2560,1440],[3440,1440],[844,390]]) {
  test(`dashboard remains complete at ${width}x${height}`, async ({ page }) => {
    await page.setViewportSize({ width, height }); await mock(page); await enter(page);
    await expect(page.getByRole("heading", { name: "Hosts monitorados" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Serviços destacados" })).toBeVisible();
    await expect(page.getByRole("button", { name: "3 · Alternância" })).toBeDisabled();
    await expect(page.getByText("0%", { exact: true }).first()).toBeVisible();
    await expect(page.getByText("Sem dados", { exact: true }).first()).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await expect(page.locator(".dashboard-panel").first()).toHaveCSS("border-radius", "14px");
    await expect(page.locator(".resource-card").first()).toHaveCSS("border-radius", "9px");
    await expect(page.locator("body")).toHaveCSS("background-color", "rgb(12, 17, 22)");
    expect(await page.locator("body").evaluate(node => getComputedStyle(node).fontFamily)).toContain("Segoe UI");
    const asgard = (await page.locator(".block-asgard_summary").boundingBox())!;
    const problems = (await page.locator(".block-problems").boundingBox())!;
    const highlights = (await page.locator(".block-highlighted_resources").boundingBox())!;
    expect(highlights.y + highlights.height).toBeLessThanOrEqual(asgard.y);
    if (width > 850) {
      expect(Math.abs(asgard.y - problems.y)).toBeLessThan(1);
      expect(asgard.x + asgard.width).toBeLessThanOrEqual(problems.x);
      expect(asgard.width).toBeLessThan(width * .55);
    } else expect(asgard.y + asgard.height).toBeLessThanOrEqual(problems.y);
    if (width >= 1201 && height >= 740) {
      expect(await page.evaluate(() => document.documentElement.scrollHeight)).toBeLessThanOrEqual(height + 1);
      expect((await page.locator(".dashboard-blocks").boundingBox())!.width).toBeGreaterThan(width * .94);
      expect(highlights.width).toBeGreaterThan(width * .94);
      const viewport = (await page.locator(".resource-grid").boundingBox())!;
      const metric = (await page.locator(".resource-card .metric-value strong").first().boundingBox())!;
      expect(metric.y).toBeGreaterThanOrEqual(viewport.y);
      expect(metric.y + metric.height).toBeLessThanOrEqual(viewport.y + viewport.height);
    }
    await mkdir(".cache/screenshots", { recursive: true });
    await page.screenshot({ path: `.cache/screenshots/dashboard-${width}.png`, fullPage: true });
    await page.getByRole("button", { name: "2 · Tela completa" }).click();
    await expect(page.locator(".dashboard")).toHaveClass(/wall/);
    await page.getByRole("button", { name: "Modo TV", exact: true }).click();
    await expect(page.getByRole("button", { name: "Sair do modo TV" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Tela cheia", exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    if (width >= 1201 && height >= 740) expect(await page.evaluate(() => document.documentElement.scrollHeight <= innerHeight + 1)).toBe(true);
    await page.screenshot({ path: `.cache/screenshots/dashboard-tv-wall-${width}.png`, fullPage: true });
    await page.getByRole("button", { name: "Sair do modo TV" }).click();
  });
}
test("configured host inventory renders from the aggregate without historical requests", async ({page}) => {
  const state = await mock(page);
  state.document.screens[0].blocks = [{id:id(900),type:"host_inventory",width:"wide",enabled:true}];
  const histories: string[] = []; page.on("request", request => {if(request.url().includes("/history"))histories.push(request.url());});
  await enter(page);
  await expect(page.locator(".host-inventory-compact")).toBeVisible();
  await expect(page.locator(".host-inventory-compact").getByRole("link",{name:"ASGARD",exact:true})).toHaveAttribute("href","/asgard?hostKey=ASGARD&range=24h");
  expect(histories).toEqual([]);
});

test("growing inventories stay inside panels without losing rows or stretching the desktop page", async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 768 });
  const state = await mock(page);
  state.transform = body => {
    const vms = body.data.asgardSummary.vms, host = body.data.asgardSummary.host!;
    const first = vms[1];
    vms.splice(0, vms.length, ...Array.from({length:100}, (_, i) => ({ ...first, vmKey: `vm-${i}`, name: `vm-operacao-${i}` })));
    const storage = host.storages[0];
    host.storages = [storage, { ...storage, key: "second", name: "local-lvm" }, { ...storage, key: "third", name: "backup" }];
    const problem = body.data.problems[0];
    body.data.problems.splice(0, 1, ...Array.from({length:50}, (_, i) => ({ ...problem, id:`problem-${i}`, description:`Problema operacional ${i}` })));
    const resource = body.data.highlightedResources[0];
    const resources = Array.from({length:12}, (_, i) => ({ ...resource, id:id(700+i), config:{...resource.config,id:id(700+i),displayName:`Recurso ${i}`} }));
    body.data.blocks.find(block => block.type === "highlighted_resources")!.data = resources;
  };
  await enter(page); await expect(page.locator(".vm-summary tbody tr")).toHaveCount(100);
  await expect(page.locator(".problem-list li")).toHaveCount(50);
  await expect(page.locator(".resource-card")).toHaveCount(12);
  expect(await page.evaluate(() => document.documentElement.scrollHeight)).toBeLessThanOrEqual(769);
  for (const selector of [".vm-table-scroll", ".problem-list", ".resource-grid"]) {
    expect(await page.locator(selector).evaluate(node => node.scrollHeight > node.clientHeight)).toBe(true);
    await page.locator(selector).focus(); await page.keyboard.press("End");
    await expect.poll(() => page.locator(selector).evaluate(node => node.scrollTop)).toBeGreaterThan(0);
  }
  await page.screenshot({ path: ".cache/screenshots/dashboard-dense-1366.png", fullPage: true });
});
test("custom compositions keep their saved order and small heights use natural page scrolling", async ({ page }) => {
  await page.setViewportSize({width:1280,height:600});
  const state = await mock(page);
  state.document.screens[0].blocks.reverse();
  await enter(page); await expect(page.getByRole("heading", {name:"Hosts monitorados"})).toBeVisible();
  await expect(page.locator(".dashboard")).not.toHaveClass(/balanced/);
  const types = await page.locator(".dashboard-block").evaluateAll(nodes => nodes.map(node => [...node.classList].find(name => name.startsWith("block-"))));
  expect(types).toEqual(state.document.screens[0].blocks.map(block => "block-"+block.type));
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollHeight > innerHeight)).toBe(true);
});
test("ASGARD summary follows the prototype and opens the protected detailed view on desktop and mobile", async ({ page }) => {
  await page.goto("/asgard"); await expect(page).toHaveURL(/\/login$/);
  const state = await mock(page);
  let failed = false, stale = false;
  const history: string[] = [];
  page.on("request", request => { if (request.url().includes("/history")) history.push(request.url()); });
  await page.route("**/api/monitoring/hosts/ASGARD/history?*", route => route.fulfill({json:{availability:"no_data",stale:false,lastUpdated:null,refreshAfterMs:20000,data:{resource:{type:"host",hostKey:"ASGARD",reference:null},window:"24h",source:"history",series:[]}}}));
  await page.route("**/api/monitoring/hosts", route => {
    const fixture = overview(state.document, undefined, stale);
    return route.fulfill(failed ? {status:503,json:{error:"unavailable"}} : {json:{...fixture,data:[fixture.data.asgardSummary.host]}});
  });
  await enter(page);
  for (const [width, height] of [[1920,1080],[390,844]]) {
    await page.setViewportSize({width,height});
    const metrics = (await page.locator(".asgard-context").boundingBox())!, table = (await page.locator(".vm-table-scroll").boundingBox())!, counter = (await page.locator(".asgard-foot").boundingBox())!;
    expect(metrics.y + metrics.height).toBeLessThanOrEqual(table.y + 1);
    expect(table.y + table.height).toBeLessThanOrEqual(counter.y + 1);
    await expect(page.getByText("16 em execução de 16 VMs", {exact:true})).toBeVisible();
    await expect(page.getByRole("columnheader", {name:"Tempo ativo"})).toHaveCount(0);
    await page.getByRole("link", {name:"Ver ASGARD"}).click();
    await expect(page).toHaveURL(/\/asgard\?hostKey=ASGARD$/);
    await expect(page.getByRole("heading", {name:"Detalhes do ASGARD",exact:true})).toBeVisible();
    await expect(page.locator(".vm-summary tbody tr")).toHaveCount(16);
    await expect(page.getByRole("columnheader", {name:"Tempo ativo"})).toBeVisible();
    await expect(page.getByRole("link", {name:"Detalhes do Agent"})).toHaveAttribute("href", "/hosts/linux-operacao?range=24h");
    await expect(page.getByText("Total", {exact:true})).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({path:`.cache/screenshots/asgard-details-${width}.png`,fullPage:true});
    await page.getByRole("link", {name:"Voltar ao dashboard"}).click();
    await expect(page.getByRole("heading", {name:"Dashboard",exact:true})).toBeVisible();
  }
  await page.getByRole("link", {name:"Ver ASGARD"}).click();
  await expect(page.getByText("16 em execução com evidência atual", {exact:true})).toBeVisible();
  failed = true; await page.getByRole("button", {name:"Atualizar ASGARD"}).click();
  await expect(page.getByText("Falha na atualização", {exact:true})).toBeVisible();
  await expect(page.getByText("0 em execução com evidência atual", {exact:true})).toBeVisible();
  await expect(page.locator(".vm-detail-panel .tone-good")).toHaveCount(0);
  failed = false; stale = true; await page.getByRole("button", {name:"Atualizar ASGARD"}).click();
  await expect(page.getByText("Dados desatualizados", {exact:true})).toBeVisible();
  stale = false; await page.getByRole("button", {name:"Atualizar ASGARD"}).click();
  await expect(page.getByText("16 em execução com evidência atual", {exact:true})).toBeVisible();
  expect(history.length).toBeGreaterThan(0);
  expect(history.every(url => new URL(url).pathname === "/api/monitoring/hosts/ASGARD/history")).toBe(true);
});
test("three compact panels share a desktop row and a single highlight stays card sized", async ({ page }) => {
  await page.setViewportSize({width:1920,height:1080});
  const state = await mock(page);
  const blocks = state.document.screens[0].blocks;
  blocks.filter(block => ["asgard_summary","problems"].includes(block.type)).forEach(block => {block.width = "standard";});
  blocks.push({id:id(900),type:"resource_card",width:"standard",enabled:true,resourceConfigId:id(90)});
  await enter(page);
  const boxes = await Promise.all(["asgard_summary","problems","resource_card"].map(type => page.locator(`.block-${type}`).boundingBox()));
  for (const box of boxes) {expect(box!.width).toBeLessThan(640); expect(Math.abs(box!.y - boxes[0]!.y)).toBeLessThan(1);}
  const highlight = page.locator(".block-highlighted_resources .resource-card");
  expect((await highlight.boundingBox())!.width).toBeLessThan(300);
  await highlight.locator("summary").click();
  await expect(highlight.locator("details")).toHaveAttribute("open", "");
  await expect(highlight.locator("details").getByText(/Amostra observada/)).toBeVisible();
  await highlight.locator("summary").click();
  await expect(highlight.locator("details")).not.toHaveAttribute("open", "");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({path:".cache/screenshots/dashboard-three-columns.png",fullPage:true});
});
test("humanized problems preserve the original description and unknown formats", async ({ page }) => {
  const state = await mock(page);
  const original = "Proxmox VE: VM [ASGARD/vm-operacao (qemu/101)]: Not running";
  state.transform = body => {
    const problem = body.data.problems[0];
    problem.description = original;
    problem.displayDescription = "vm-operacao (101) · Not running";
    body.data.problems.push({ ...problem, id: "problem-unknown", description: "Descrição original sem padrão conhecido", displayDescription: undefined });
  };
  await page.setViewportSize({ width: 390, height: 844 });
  await enter(page);
  await expect(page.getByText("vm-operacao (101) · Not running", { exact: true })).toHaveAttribute("title", original);
  await expect(page.getByText("Descrição original sem padrão conhecido", { exact: true })).toBeVisible();
  await expect(page.getByText(original, { exact: true })).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
test("polls only the visible overview and preserves stale data after failure without repeated toast", async ({ page }) => {
  const state = await mock(page); await enter(page); await expect(page.getByRole("heading", { name: "Hosts monitorados" })).toBeVisible();
  state.fail = true;
  await page.getByRole("button", { name: "Atualizar monitoramento" }).click();
  await expect(page.getByText("Falha na atualização", { exact: true })).toBeVisible();
  await expect(page.getByText("Aplicação monitorada", { exact: true })).toBeVisible();
  await expect(page.locator(".resource-card .tone-good")).toHaveCount(0);
  await page.getByRole("button", { name: "Atualizar monitoramento" }).click();
  await expect(page.locator('[data-sonner-toast]')).toHaveCount(1);
  expect(new Set(state.calls)).toEqual(new Set([id(1)]));
  state.fail = false; state.stale = true; await page.getByRole("button", { name: "Atualizar monitoramento" }).click();
  await expect(page.getByText("Dados desatualizados", { exact: true }).first()).toBeVisible();
});

test("container cards respect preferences and distinguish running, health, missing and unsupported evidence", async ({ page }) => {
  const state = await mock(page);
  let health: Container["health"] = "not_configured";
  state.transform = body => {
    const item = body.data.highlightedResources[0];
    item.config.resourceType = "docker_container";
    const preferences = { ...item.config.presentation, showHealth: true, showHealthTimeline: false, healthTimelineRange: "1h", showNetwork: true };
    item.config.presentation = preferences;
    item.metrics.cpuUsagePercent!.value = 125.5;
    item.metrics.networkReceiveBitsPerSecond = { value: null, unit: "bits/s", observedAt: null, quality: "unsupported" };
    item.metrics.networkTransmitBitsPerSecond = { value: 1000000, unit: "bits/s", observedAt: body.lastUpdated, quality: "fresh" };
    item.resource = { reference: "opaque-test", hostKey: "ASGARD", name: "container-operacao", image: null, status: "running", health, healthReason: health === "unknown" ? "missing" : "observed", metrics: item.metrics, evidence: item.resource!.evidence };
    (body.data.blocks.find(block => block.type === "highlighted_resources")!.data as ConfiguredResource[])[0] = item;
  };
  await enter(page);
  const card = page.locator(".resource-card");
  await expect(card.getByText("Em execução", { exact: true })).toBeVisible();
  await expect(card.getByText("Sem healthcheck", { exact: true })).toBeVisible();
  await expect(card.getByText("Saudável", { exact: true })).toHaveCount(0);
  await expect(card.getByText("125,5%", { exact: true })).toBeVisible();
  await expect(card.getByText("1 Mbit/s", { exact: true })).toBeVisible();
  await expect(card.getByText("Não suportado pela origem", { exact: true })).toBeVisible();
  await expect(card.getByText("Disco utilizado", { exact: true })).toHaveCount(0);
  health = "unknown";
  await page.getByRole("button", { name: "Atualizar monitoramento" }).click();
  await expect(card.getByText("Desconhecido", { exact: true })).toBeVisible();
  await expect(card.getByText("Healthcheck não informado pela origem", { exact: true })).toBeVisible();
});
test("three screens rotate, manual choice and reading pause, resume gets a complete interval", async ({ page }) => {
  const state = await mock(page, 3); await enter(page); await expect(page.getByRole("heading", { name: "Hosts monitorados" })).toBeVisible();
  await page.clock.install();
  await page.getByRole("button", { name: "3 · Alternância" }).click();
  await page.clock.runFor(5100); await expect(page.getByLabel("Escolher tela")).toHaveValue(id(2));
  await expect(page.locator(".dashboard")).toHaveClass(/wall/);
  await page.clock.runFor(5100); await expect(page.getByLabel("Escolher tela")).toHaveValue(id(3));
  await page.clock.runFor(5100); await expect(page.getByLabel("Escolher tela")).toHaveValue(id(1));
  await page.getByRole("button", { name: "Próxima tela", exact: true }).click();
  await page.clock.runFor(12000); await expect(page.getByLabel("Escolher tela")).toHaveValue(id(2));
  await expect(page.getByRole("button", { name: "Continuar alternância" })).toBeVisible();
  await page.getByRole("button", { name: "Continuar alternância" }).click();
  await page.clock.runFor(4000); await expect(page.getByLabel("Escolher tela")).toHaveValue(id(2));
  await page.clock.runFor(1500); await expect(page.getByLabel("Escolher tela")).toHaveValue(id(3));
  await page.locator(".vm-table-scroll").focus();
  await page.clock.runFor(12000); await expect(page.getByLabel("Escolher tela")).toHaveValue(id(3));
  expect(new Set(state.calls)).toEqual(new Set([id(1), id(2), id(3)]));
});
test("configuration failure, initial failure and empty highlights remain honest", async ({ page }) => {
  const state = await mock(page); state.configFail = true; await enter(page);
  await expect(page.getByText("Não foi possível carregar a configuração", { exact: true })).toBeVisible();
  state.configFail = false; state.fail = true; await page.getByRole("button", { name: "Tentar novamente", exact: true }).click();
  await expect(page.getByText("Falha na atualização", { exact: true })).toBeVisible();
  await expect(page.locator(".dashboard-kpi")).toHaveCount(0);
  state.fail = false; state.empty = true; await page.getByRole("button", { name: "Atualizar monitoramento" }).click();
  await expect(page.getByText(/Nenhum serviço destacado/)).toBeVisible();
  await expect(page.locator(".resource-card")).toHaveCount(0);
  await expect(page.getByText("Explorar cenário", { exact: true })).toHaveCount(0);
});
test("fullscreen refusal keeps TV and playback available; shortcuts ignore form fields", async ({ page }) => {
  await mock(page, 2); await enter(page); await expect(page.getByRole("heading", { name: "Hosts monitorados" })).toBeVisible();
  await page.evaluate(() => { document.documentElement.requestFullscreen = async () => { throw new Error("denied"); }; });
  await page.getByRole("button", { name: "Tela cheia", exact: true }).click();
  await expect(page.getByText(/Tela cheia indisponível neste navegador/)).toBeVisible();
  await page.getByLabel("Escolher tela").focus(); await page.keyboard.press("t");
  await expect(page.getByRole("button", { name: "Modo TV", exact: true })).toHaveAttribute("aria-pressed", "false");
  await page.getByRole("heading", { name: "Dashboard", exact: true }).click(); await page.keyboard.press("t");
  await expect(page.getByRole("button", { name: "Sair do modo TV" })).toBeVisible();
  await page.keyboard.press("r"); await expect(page.getByRole("button", { name: "Parar alternância" })).toBeVisible();
});
test("two and three presentations saved through the real BFF play without writing local defaults", async ({ page }) => {
  await enter(page);
  const session = await page.evaluate(() => JSON.parse(localStorage.getItem("pulse.auth.v1")!).session);
  const headers = { Authorization: "Bearer " + session.accessToken };
  let current = (await (await page.request.get("/api/settings/presentation", { headers })).json()).data;
  for (const count of [2, 3]) {
    const saved = presentation(count, current.revision);
    const settings = { schemaVersion: saved.schemaVersion, defaultTvMode: saved.defaultTvMode, rotation: saved.rotation, screens: saved.screens };
    const response = await page.request.put("/api/settings/presentation", { headers, data: { expectedRevision: current.revision, settings } });
    expect(response.status()).toBe(200); current = (await response.json()).data;
    await page.reload(); await expect(page.getByLabel("Escolher tela").locator("option")).toHaveCount(count);
    await page.getByRole("button", { name: "Alternar telas", exact: true }).click();
    await expect(page.getByLabel("Escolher tela")).toHaveValue(id(2), { timeout: 9000 });
    await page.getByRole("button", { name: "Parar alternância", exact: true }).click();
    const unchanged = (await (await page.request.get("/api/settings/presentation", { headers })).json()).data;
    expect(unchanged).toEqual(current);
    await expect(page.getByText("Aguardando dados do monitoramento", { exact: true })).toBeVisible();
  }
});

test("remote revision waits while reading and removal chooses a valid screen without restarting a stopped player", async ({ page }) => {
  const state = await mock(page, 3); await enter(page); await expect(page.getByRole("heading", { name: "Hosts monitorados" })).toBeVisible();
  await page.getByRole("button", { name: "3 · Alternância" }).click();
  await page.getByLabel("Escolher tela").selectOption(id(2));
  state.document = presentation(3, 2); state.document.screens[1].name = "Operação revisada";
  await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
  await expect(page.getByText(/Configuração atualizada\./)).toBeVisible();
  await expect(page.getByLabel("Escolher tela").locator("option:checked")).toHaveText("Operação");
  await page.getByRole("button", { name: "Continuar alternância" }).click();
  await expect(page.getByLabel("Escolher tela").locator("option:checked")).toHaveText("Operação revisada");
  await page.getByRole("button", { name: "Parar alternância", exact: true }).click();
  state.document = presentation(3, 3, true); state.document.screens[1].enabled = false;
  await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
  await expect(page.getByLabel("Escolher tela")).toHaveValue(id(1));
  await expect(page.getByText(/A tela anterior foi removida/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Alternar telas", exact: true })).toHaveAttribute("aria-pressed", "false");
});
test("hidden tab and dialog suspend playback; manual stop survives closing the dialog", async ({ page }) => {
  await mock(page, 2, true); await enter(page); await expect(page.getByRole("heading", { name: "Hosts monitorados" })).toBeVisible();
  await page.clock.install();
  await page.evaluate(() => { Object.defineProperty(document, "hidden", { configurable: true, value: true }); document.dispatchEvent(new Event("visibilitychange")); });
  await page.clock.runFor(20000); await expect(page.getByLabel("Escolher tela")).toHaveValue(id(1));
  await page.evaluate(() => { Object.defineProperty(document, "hidden", { configurable: true, value: false }); document.dispatchEvent(new Event("visibilitychange")); });
  await page.clock.runFor(4000); await expect(page.getByLabel("Escolher tela")).toHaveValue(id(1));
  await page.clock.runFor(1500); await expect(page.getByLabel("Escolher tela")).toHaveValue(id(2));
  await page.evaluate(() => { const dialog = document.createElement("dialog"); dialog.id = "test-dialog"; document.body.append(dialog); dialog.show(); });
  await expect(page.getByText("Alternância pausada para leitura", { exact: true })).toBeVisible();
  await page.clock.runFor(10000); await expect(page.getByLabel("Escolher tela")).toHaveValue(id(2));
  await page.getByRole("button", { name: "Parar alternância", exact: true }).click();
  await page.evaluate(() => document.getElementById("test-dialog")!.remove());
  await page.clock.runFor(10000); await expect(page.getByLabel("Escolher tela")).toHaveValue(id(2));
});
test("slow responses cannot paint the next screen and refresh clicks share one request", async ({ page }) => {
  const state = await mock(page, 3); await enter(page); await expect(page.getByRole("heading", { name: "Hosts monitorados" })).toBeVisible();
  state.delay = 1500;
  const previous = state.calls.length;
  await page.getByRole("button", { name: "Atualizar monitoramento" }).click();
  await page.getByRole("button", { name: "Atualizar monitoramento" }).click();
  await expect.poll(() => state.calls.length).toBe(previous + 1);
  await page.getByLabel("Escolher tela").selectOption(id(3));
  await expect(page.getByLabel("Escolher tela")).toHaveValue(id(3));
  await expect(page.getByRole("heading", { name: "Hosts monitorados" })).toBeVisible();
  expect(state.calls.at(-1)).toBe(id(3));
  expect(state.calls).not.toContain(id(2));
  await page.getByRole("button", { name: "Sair", exact: true }).click();
  await expect(page).toHaveURL(/\/login$/);
});
test("TV plus fullscreen keeps playback and exit controls; browser exit updates the icon", async ({ page }) => {
  await mock(page, 2); await enter(page); await expect(page.getByRole("heading", { name: "Hosts monitorados" })).toBeVisible();
  await page.getByRole("button", { name: "Modo TV", exact: true }).click();
  await page.getByRole("button", { name: "Tela cheia", exact: true }).click();
  await expect(page.getByRole("button", { name: "Sair da tela cheia" })).toBeVisible();
  expect(await page.evaluate(() => document.fullscreenElement === document.documentElement)).toBe(true);
  await page.getByRole("button", { name: "Alternar telas", exact: true }).click();
  await expect(page.getByLabel("Escolher tela")).toHaveValue(id(2), { timeout: 9000 });
  expect(await page.evaluate(() => !!document.fullscreenElement)).toBe(true);
  await page.getByRole("button", { name: "Parar alternância", exact: true }).click();
  await page.evaluate(() => document.exitFullscreen());
  await expect(page.getByRole("button", { name: "Tela cheia", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Sair do modo TV" })).toBeVisible();
});
test("touch targets, reduced motion and 200 percent zoom retain all controls and table scrolling", async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, reducedMotion: "reduce" });
  const page = await context.newPage(); await mock(page, 2); await enter(page); await expect(page.getByRole("heading", { name: "Hosts monitorados" })).toBeVisible();
  for (const name of ["Modo TV", "Tela cheia", "Próxima tela", "3 · Alternância"]) {
    const box = await page.getByRole("button", { name, exact: true }).boundingBox(); expect(box!.height).toBeGreaterThanOrEqual(44); expect(box!.width).toBeGreaterThanOrEqual(44);
  }
  const evidence = page.locator(".resource-evidence summary").first();
  expect((await evidence.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  await evidence.tap();
  await expect(page.locator(".resource-evidence").first()).toHaveAttribute("open", "");
  await evidence.tap();
  await page.getByRole("button", { name: "3 · Alternância" }).tap();
  await page.locator(".resource-card").tap();
  await expect(page.getByRole("button", { name: "Continuar alternância" })).toBeVisible();
  await page.locator(".vm-table-scroll").evaluate(node => { node.scrollLeft = node.scrollWidth; });
  expect(await page.locator(".vm-table-scroll").evaluate(node => node.scrollLeft > 0)).toBe(true);
  await context.close();
  const zoom = await browser.newContext({ viewport: { width: 1366, height: 768 } });
  const zoomPage = await zoom.newPage(); await mock(zoomPage); await enter(zoomPage);
  await zoomPage.evaluate(() => { document.documentElement.style.zoom = "2"; });
  await expect(zoomPage.getByRole("button", { name: "Tela cheia", exact: true })).toBeVisible();
  expect(await zoomPage.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await zoomPage.screenshot({ path: ".cache/screenshots/dashboard-zoom-200.png", fullPage: true });
  await zoom.close();
});
