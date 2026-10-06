import { test, expect, type Page } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { infrastructureFixture, signIn } from "../fixtures/infrastructure";

async function start(page: Page, url = "/asgard?hostKey=ASGARD") {
  const state = await infrastructureFixture(page); await signIn(page); await page.goto(url); return state;
}
const hostPanel = (page: Page) => page.getByRole("region", { name: "Histórico de ASGARD", exact: true });
const vmPanel = (page: Page, vm = "vm-operacao-1") => page.getByRole("region", { name: `Histórico de ${vm}`, exact: true });

test("VM indicators use its own capacity and linked filesystems, keeping host details separate", async ({ page }) => {
  const state = await infrastructureFixture(page), vm = state.hosts[0].vms[1];
  const sample = vm.metrics.cpuUsagePercent!;
  vm.metrics.provisionedCpuCount = {...sample,unit:"count",value:8};
  vm.metrics.memoryUsagePercent = {...sample,value:25};
  vm.metrics.memoryTotalBytes = {...sample,unit:"bytes",value:8*1024**3};
  vm.metrics.diskTotalBytes = {...sample,unit:"bytes",value:120*1024**3};
  state.problems.push({...state.problems[0],id:"vm-problem",description:"Problema exclusivo da VM",resource:{type:"vm",hostKey:"ASGARD",reference:vm.vmKey}});
  await signIn(page); await page.goto("/asgard?hostKey=ASGARD");
  await page.getByRole("link",{name:vm.name,exact:true}).click();
  const kpis = page.getByRole("region",{name:`Indicadores da VM ${vm.name}`});
  await expect(kpis.getByRole("heading",{name:"CPU da VM"})).toBeVisible();
  await expect(kpis.locator("article").nth(0)).toContainText("1%");
  await expect(kpis.locator("article").nth(0)).toContainText("8 vCPUs");
  await expect(kpis.locator("article").nth(1)).toContainText("25%");
  await expect(kpis.locator("article").nth(1)).toContainText("8 GiB");
  await expect(kpis.locator("article").nth(2)).toContainText("120 GiB");
  await expect(kpis.locator("article").nth(3).locator(".kpi-value")).toHaveText("—");
  await expect(page.locator(".asgard-storage,.vm-state-summary")).toHaveCount(0);
  await expect(hostPanel(page)).toHaveCount(0);
  await expect(page.getByText("Problema exclusivo da VM",{exact:true})).toBeVisible();
  await expect(page.getByText("Atenção na coleta da unidade",{exact:true})).toHaveCount(0);
  await expect(page.locator(".selected-vm-current").getByText("Tempo ativo",{exact:true})).toBeVisible();
  await expect(page.locator(".selected-vm-current").getByText(/^(CPU|RAM|RAM usada|RAM total)$/)).toHaveCount(0);
  await page.getByRole("link",{name:"Voltar ao ASGARD",exact:true}).click();
  await expect(page.getByRole("heading",{name:"CPU do host",exact:true})).toBeVisible();
  await expect(hostPanel(page).locator("canvas")).toHaveCount(1);
  expect(state.containerCalls).toHaveLength(0);
});

test("VM container card queries only the linked Agent and distinguishes missing, stale and failed data", async ({ page }) => {
  const state = await infrastructureFixture(page), agent = state.hosts[1];
  state.hosts[0].vms[0].name = "vm-com-agent";
  state.containers = ["running","stopped","running"].map((status,index) => ({reference:`container-${index}`,hostKey:agent.hostKey,name:`container-${index}`,image:null,status:status as "running"|"stopped",health:"not_configured",metrics:{},evidence:agent.evidence}));
  await signIn(page); await page.goto("/asgard?hostKey=ASGARD&vm=vm-0");
  const kpi = page.locator(".vm-container-kpi");
  await expect(kpi.locator(".kpi-value")).toHaveText("2");
  await expect(kpi).toContainText("3 individualizados pelo Zabbix");
  await expect(page.locator(".vm-kpis article").nth(2)).toContainText("Filesystem raiz / · Agent");
  expect(state.containerCalls).toEqual(["/api/monitoring/hosts/linux-operacao/containers"]);
  await page.getByLabel("Host ou VM do gráfico").selectOption("vm-1");
  await expect(kpi.locator(".kpi-value")).toHaveText("—");
  await expect(kpi).toContainText("Agent ainda não disponível");
  expect(state.containerCalls).toHaveLength(1);
  state.containersStale = true;
  await page.getByLabel("Host ou VM do gráfico").selectOption("vm-0");
  await expect(kpi).toContainText("Evidência desatualizada");
  await expect(kpi.locator(".kpi-value")).toHaveText("—");
  state.containersStale = false; state.containers = [];
  await page.reload(); await expect(kpi).toContainText("Nenhum container individualizado");
  await expect(kpi.locator(".kpi-value")).toHaveText("—");
  state.containersFailed = true;
  await page.reload(); await expect(kpi.getByRole("button",{name:"Tentar novamente"})).toBeVisible();
  state.containersFailed = false;
  await kpi.getByRole("button",{name:"Tentar novamente"}).click();
  await expect(kpi).toContainText("Nenhum container individualizado");
  state.containers = [{reference:"unknown",hostKey:agent.hostKey,name:"unknown",image:null,status:"unknown",health:"unknown",metrics:{},evidence:agent.evidence}];
  await page.reload(); await expect(kpi).toContainText("Sem evidência atual dos containers");
  await expect(kpi.locator(".kpi-value")).toHaveText("—");
  state.containers[0].status = "running";
  state.containers[0].evidence = {...agent.evidence,validUntil:new Date(Date.now()-60000).toISOString()};
  await page.reload(); await expect(kpi).toContainText("Sem evidência atual dos containers");
  await expect(kpi.locator(".kpi-value")).toHaveText("—");
  state.containers = [{reference:"wrong-host",hostKey:"ASGARD",name:"wrong-host",image:null,status:"running",health:"healthy",metrics:{},evidence:agent.evidence}];
  await page.reload(); await expect(kpi).toContainText("Falha ao consultar");
  await expect(kpi.locator(".kpi-value")).toHaveText("—");
  state.hosts = [state.hosts[0]];
  const requests = state.containerCalls.length;
  await page.reload(); await expect(kpi).toContainText("Agent associado sem dados");
  expect(state.containerCalls).toHaveLength(requests);
});

test("VM rows stay compact with multiple Agent filesystems and explicit CPU capacity sources", async ({ page }) => {
  const state = await infrastructureFixture(page), host = state.hosts[0], agent = state.hosts[1];
  const sample = { ...host.metrics.cpuUsagePercent!, unit: "count" as const, value: 4 };
  agent.metrics.osCpuCount = sample;
  host.vms[0].name = "vm-com-agent";
  host.vms[0].metrics.provisionedCpuCount = { ...sample, value: 8 };
  host.vms[1].metrics.provisionedCpuCount = { ...sample, value: 8 };
  for (const vm of host.vms) {
    vm.metrics.memoryUsagePercent = { ...sample, unit: "percent", value: 25 };
    vm.metrics.memoryTotalBytes = { ...sample, unit: "bytes", value: 8 * 1024 ** 3 };
  }
  agent.filesystems = ["/", "/boot", "/data", "/var/lib/docker"].map(name => ({ ...agent.filesystems[0], key: name, name }));
  await signIn(page); await page.goto("/asgard?hostKey=ASGARD");
  const rows = page.locator(".vm-details-table tbody tr"), linked = rows.first();
  await expect(linked.locator(".vm-cpu-count")).toHaveText("8 vCPUs");
  await expect(rows.nth(1).locator(".vm-cpu-count")).toHaveText("8 vCPUs");
  await expect(rows.nth(2).locator(".vm-cpu-count")).toHaveText("vCPUs: —");
  await expect(rows.getByText(/Proxmox|CPUs · SO|SO: indisponível/)).toHaveCount(0);
  await expect(linked.locator(".vm-cpu-count")).toHaveCount(1);
  await expect(linked.locator(".vm-agent-summary")).toContainText("Raiz / · 4 filesystems");
  await expect(linked.locator(".vm-agent-summary svg")).toHaveCount(1);
  await expect(linked.getByText("/boot", { exact: true })).toHaveCount(0);
  for (const width of [1920, 1366, 390]) {
    await page.setViewportSize({ width, height: 1080 });
    await expect(hostPanel(page).locator("canvas")).toHaveCount(1);
    const heights = await rows.evaluateAll(elements => elements.map(element => element.getBoundingClientRect().height));
    expect(Math.max(...heights) - Math.min(...heights)).toBeLessThan(2);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await mkdir(".cache/screenshots", { recursive: true });
    await page.locator(".vm-detail-panel").screenshot({ path: `.cache/screenshots/vm-compact-${width}.png` });
  }
  expect(state.calls).toHaveLength(1);
  await linked.getByRole("link", { name: "Detalhes do Agent" }).click();
  await expect(page.getByText("/boot", { exact: true })).toBeVisible();
  await expect(page.getByText("/var/lib/docker", { exact: true })).toBeVisible();
  await expect(page.getByText("CPUs reconhecidas · SO", { exact: true })).toBeVisible();
  await page.goto("/asgard?hostKey=ASGARD&vm=vm-0");
  await expect(linked.locator(".vm-cpu-count")).toHaveText("8 vCPUs");
  await page.getByText("Perspectiva do Agent desta VM", { exact: true }).click();
  await expect(page.locator(".agent-context").getByText("CPUs reconhecidas · SO", { exact: true })).toBeVisible();
  host.vms[0].metrics.provisionedCpuCount = { ...sample, value: 8, quality: "stale" };
  await page.getByRole("button", { name: "Atualizar VM", exact: true }).click();
  await expect(linked.locator(".vm-cpu-count")).toHaveText("8 vCPUs");
  await expect(linked.locator(".vm-cpu-count")).toHaveClass(/metric-old/);
  delete host.vms[0].metrics.provisionedCpuCount;
  await page.getByRole("button", { name: "Atualizar VM", exact: true }).click();
  await expect(linked.locator(".vm-cpu-count")).toHaveText("vCPUs: —");
  agent.metrics.osCpuCount.validUntil = new Date(Date.now() - 60000).toISOString();
  agent.filesystems[0].metrics.diskUsagePercent = { ...sample, unit: "percent", validUntil: agent.metrics.osCpuCount.validUntil };
  await page.getByRole("button", { name: "Atualizar VM", exact: true }).click();
  await expect(linked.locator(".vm-cpu-count")).toHaveText("vCPUs: —");
  await expect(linked.locator(".vm-agent-summary svg")).toHaveCount(0);
  agent.metrics.osCpuCount.quality = "unsupported"; agent.metrics.osCpuCount.value = null;
  agent.filesystems = agent.filesystems.filter(fs => fs.name !== "/");
  await page.getByRole("button", { name: "Atualizar VM", exact: true }).click();
  await expect(linked.locator(".vm-cpu-count")).toHaveText("vCPUs: —");
  await expect(linked.locator(".vm-agent-summary")).toContainText("Raiz sem leitura");
});

test("VM totals reflect evidence and fill the storage column beside history", async ({page}) => {
  const state = await infrastructureFixture(page), host = state.hosts[0];
  host.vms[1].state = "stopped"; host.vms[2].state = "paused"; host.vms[3].state = "unknown";
  host.vms[4].evidence = {...host.vms[4].evidence,validUntil:new Date(Date.now()-60000).toISOString()};
  host.storages = ["local", "local-lvm", "muninn-pbs"].map(name => ({...host.storages[0],key:name,name}));
  await signIn(page); await page.goto("/asgard?hostKey=ASGARD");
  const summary = page.getByRole("region",{name:"Resumo das VMs"});
  const total = (label:string) => summary.locator(".vm-state-counts > div").filter({hasText:label}).locator("dd");
  await expect(summary.getByText("16 VMs no inventário")).toBeVisible();
  for (const [label,count] of [["Em execução","12"],["Paradas","1"],["Pausadas","1"],["Sem estado atual","2"]]) await expect(total(label)).toHaveText(count);
  for (const width of [1920,1366,390]) {
    await page.setViewportSize({width,height:1080}); await expect(hostPanel(page).locator("canvas")).toHaveCount(1);
    const storage = (await page.locator(".asgard-storage > .device-panel").boundingBox())!, totals = (await summary.boundingBox())!, chart = (await hostPanel(page).boundingBox())!;
    expect(totals.y).toBeGreaterThanOrEqual(storage.y+storage.height);
    if(width>1100) {expect(Math.abs(totals.y+totals.height-chart.y-chart.height)).toBeLessThan(2);expect(storage.x+storage.width).toBeLessThan(chart.x);}
    else expect(chart.y).toBeGreaterThanOrEqual(totals.y+totals.height);
    expect(await page.evaluate(() => document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    await mkdir(".cache/screenshots",{recursive:true});
    await page.locator(".asgard-detail-layout").screenshot({path:`.cache/screenshots/asgard-totals-${width}.png`});
  }
  await page.setViewportSize({width:1920,height:1080});
  await page.getByLabel("Host ou VM do gráfico").selectOption("vm-1");
  await expect(vmPanel(page).locator("canvas")).toHaveCount(1);
  await expect(summary).toHaveCount(0);
  await expect(page.locator(".asgard-storage")).toHaveCount(0);
  await page.getByLabel("Host ou VM do gráfico").selectOption("");
  await expect(summary).toBeVisible();
  state.hostsFailed = true; await page.getByRole("button",{name:"Atualizar ASGARD",exact:true}).click();
  await expect(total("Em execução")).toHaveText("0"); await expect(total("Sem estado atual")).toHaveText("16");
  state.hostsFailed = false; host.vms = []; await page.getByRole("button",{name:"Atualizar ASGARD",exact:true}).click();
  await expect(summary.getByText("0 VMs no inventário")).toBeVisible();
});

test("VM links and selector switch the whole view without loading parent history", async ({ page }) => {
  const state = await infrastructureFixture(page); await signIn(page);
  const link = page.getByRole("link", { name: "vm-operacao-1", exact: true });
  await expect(link).toHaveAttribute("href", "/asgard?hostKey=ASGARD&vm=vm-1&range=24h");
  await link.click();
  await expect(page.getByLabel("Host ou VM do gráfico")).toHaveValue("vm-1");
  await expect(vmPanel(page).locator("canvas")).toHaveCount(1);
  await expect(hostPanel(page)).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Detalhes da VM · vm-operacao-1", exact: true })).toBeVisible();
  await expect(page.locator(".host-kpis")).toHaveAttribute("aria-label", "Indicadores da VM vm-operacao-1");
  await expect(page.getByRole("heading", {name:"CPU do host",exact:true})).toHaveCount(0);
  await expect(page.getByText("Atenção na coleta da unidade", {exact:true})).toHaveCount(0);
  await expect(page.locator(".vm-selected .vm-name-link")).toHaveAttribute("aria-current", "true");
  await page.getByLabel("Host ou VM do gráfico").selectOption("vm-2");
  await expect(page).toHaveURL(/vm=vm-2&range=24h/);
  await expect(vmPanel(page, "vm-operacao-2").locator("canvas")).toHaveCount(1);
  await expect(page.getByLabel("Host ou VM do gráfico")).toBeFocused();
  expect(state.calls.filter(url => url.includes("/ASGARD/history"))).toHaveLength(0);
  expect(state.calls.filter(url => url.includes("/vms/"))).toHaveLength(2);
  await page.goBack(); await expect(page.getByLabel("Host ou VM do gráfico")).toHaveValue("vm-1");
  await expect(vmPanel(page).locator("canvas")).toHaveCount(1);
  expect(state.calls).toHaveLength(2);
  await page.goForward(); await expect(page.getByLabel("Host ou VM do gráfico")).toHaveValue("vm-2");
  await page.getByRole("button", { name: "7 dias", exact: true }).click();
  await expect(vmPanel(page, "vm-operacao-2").getByText(/Médias horárias/)).toBeVisible();
  expect(state.calls.filter(url => url.endsWith("range=7d"))).toHaveLength(1);
  await page.reload(); await expect(page.getByLabel("Host ou VM do gráfico")).toHaveValue("vm-2");
  await expect(page.getByRole("button", { name: "7 dias", exact: true })).toHaveAttribute("aria-pressed", "true");
  await page.getByLabel("Host ou VM do gráfico").selectOption("");
  await expect(page.getByLabel("Host ou VM do gráfico")).toBeFocused();
  await expect(page.locator(".vm-selected")).toHaveCount(0);
  await expect(page.locator(".history-panel")).toHaveCount(1);
});

test("VM without Agent remains usable; linked Agent adds only its own history when opened", async ({ page }) => {
  const state = await start(page, "/asgard?hostKey=ASGARD&vm=vm-1&range=1h");
  await expect(vmPanel(page).locator("canvas")).toHaveCount(1);
  await expect(page.getByText("Agent ainda não disponível para esta VM.", {exact:true})).toBeVisible();
  expect(state.calls).toHaveLength(1);
  expect(state.containerCalls).toHaveLength(0);
  await page.getByLabel("Host ou VM do gráfico").selectOption("vm-0");
  await expect(page.locator(".agent-context").getByRole("link", { name: "Detalhes do Agent" })).toHaveAttribute("href", "/hosts/linux-operacao?range=1h");
  expect(state.calls.filter(url => url.includes("linux-operacao/history"))).toHaveLength(0);
  await page.getByText("Perspectiva do Agent desta VM", { exact: true }).click();
  await expect(page.getByRole("region", { name: "Histórico de Linux operação" }).locator("canvas")).toHaveCount(1);
  expect(state.calls.filter(url => url.includes("linux-operacao/history"))).toHaveLength(1);
  expect(state.calls.filter(url => url.includes("/ASGARD/history"))).toHaveLength(0);
  expect(state.containerCalls).toEqual(["/api/monitoring/hosts/linux-operacao/containers"]);
  await page.locator(".agent-context").getByRole("link", { name: "Detalhes do Agent" }).click();
  await expect(page.getByRole("heading", { name: "Linux operação", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Filesystems", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Rede por interface" })).toBeVisible();
});

test("invalid selection never falls back to a neighboring VM, including disappearance", async ({ page }) => {
  const state = await start(page, "/asgard?hostKey=ASGARD&vm=unknown&range=24h");
  await expect(page.getByRole("heading", { name: "VM não encontrada" })).toBeVisible();
  expect(state.calls.some(url => url.includes("/vms/"))).toBe(false);
  await page.goto("/asgard?hostKey=missing&vm=vm-1");
  await expect(page.getByRole("heading", { name: "Hipervisor não encontrado" })).toBeVisible();
  await expect(page.locator(".history-panel")).toHaveCount(0);
  await page.goto("/asgard?hostKey=ASGARD&hostKey=other");
  await expect(page.getByRole("heading", { name: "Parâmetros inválidos" })).toBeVisible();
  await page.goto("/asgard?hostKey=ASGARD&vm=vm-1");
  await expect(vmPanel(page).locator("canvas")).toHaveCount(1);
  state.hosts[0].vms = state.hosts[0].vms.filter(vm => vm.vmKey !== "vm-1");
  await page.getByRole("button", { name: "Atualizar VM", exact: true }).click();
  await expect(page.getByRole("heading", { name: "VM não encontrada" })).toBeVisible();
  await expect(page).toHaveURL(/vm=vm-1/);
  await expect(page.getByText("Última identificação: vm-operacao-1 · ASGARD.")).toBeVisible();
  await expect(page.locator(".vm-selected")).toHaveCount(0);
});

test("history failures recover, samples expose gaps and byte units, and identity mismatch is rejected", async ({ page }) => {
  const state = await infrastructureFixture(page); state.failed = true; await signIn(page); await page.goto("/asgard");
  await expect(hostPanel(page).getByRole("alert")).toContainText("Não foi possível carregar");
  await expect(page.getByRole("heading", { name: "CPU do host" })).toBeVisible();
  state.failed = false; await hostPanel(page).getByRole("button", { name: "Tentar novamente" }).click();
  await expect(hostPanel(page).locator("canvas")).toHaveCount(1);
  await expect(hostPanel(page).getByText(/Cobertura parcial/)).toBeVisible();
  const slider = hostPanel(page).getByRole("slider");
  await slider.focus(); await slider.press("Home");
  await expect(hostPanel(page).locator(".history-tooltip dd")).toHaveText("0%");
  await slider.press("ArrowRight"); await slider.press("ArrowRight");
  await expect(hostPanel(page).locator(".history-tooltip dd")).toHaveText("Sem dados");
  await hostPanel(page).getByLabel("Métricas de ASGARD").selectOption({ label: "RAM (capacidade)" });
  await expect(hostPanel(page).locator(".history-tooltip dd")).toHaveText("4 GiB");
  state.empty = true; await hostPanel(page).getByRole("button", { name: "Atualizar histórico" }).click();
  await expect(hostPanel(page).getByText(/Nenhuma série disponível/)).toBeVisible();
  state.empty = false; state.mismatch = true; await page.getByLabel("Host ou VM do gráfico").selectOption("vm-1");
  await expect(vmPanel(page).getByRole("alert")).toBeVisible();
  await expect(vmPanel(page).locator("canvas")).toHaveCount(0);
});

test("a delayed VM response cannot overwrite a later selection", async ({ page }) => {
  const state = await start(page);
  state.delayed = "vm-1"; state.requestStarted = new Promise<void>(resolve => { state.startRequest = resolve; });
  await page.getByLabel("Host ou VM do gráfico").selectOption("vm-1"); await state.requestStarted;
  await page.getByLabel("Host ou VM do gráfico").selectOption("vm-2");
  await expect(vmPanel(page, "vm-operacao-2").locator("canvas")).toHaveCount(1); state.release();
  await expect(page.locator(".vm-selected .vm-name-link")).toContainText("vm-operacao-2");
  await expect(vmPanel(page)).toHaveCount(0);
});

for (const [width,height] of [[320,568],[360,800],[390,844],[768,1024],[1024,768],[1366,768],[1920,1080],[2560,1440],[3440,1440],[844,390]]) {
  test(`infrastructure details and charts resize without page overflow at ${width}x${height}`, async ({page}) => {
    await page.setViewportSize({width,height}); const state = await start(page);
    await expect(hostPanel(page).locator("canvas")).toHaveCount(1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollHeight > innerHeight)).toBe(true);
    await page.getByLabel("Host ou VM do gráfico").selectOption("vm-1");
    await expect(vmPanel(page).locator("canvas")).toHaveCount(1);
    await expect(page.locator(".vm-selected")).toHaveCSS("background-color", "rgb(25, 44, 41)");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await mkdir(".cache/screenshots",{recursive:true});
    await page.screenshot({path:`.cache/screenshots/phase06-vm-${width}.png`,fullPage:true});
    if (width === 1920 || width === 390) { await page.evaluate(() => scrollTo(0,0)); await page.screenshot({path:`.cache/screenshots/phase06-vm-viewport-${width}.png`}); }
    const originalCalls = state.calls.length;
    await page.setViewportSize({width: Math.max(320,width - 120),height});
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect(state.calls.length).toBe(originalCalls);
    await page.getByRole("link",{name:"Infraestrutura",exact:true}).click();
    await expect(page.getByRole("heading",{name:"Infraestrutura",exact:true})).toBeVisible();
    await expect(page.getByRole("link",{name:"Linux operação",exact:true})).toBeVisible();
    await page.getByLabel("Filtrar host").selectOption("linux-operacao");
    await expect(page.locator(".vm-summary")).toHaveCount(0);
    await page.getByRole("link",{name:"Linux operação",exact:true}).click();
    await expect(page.getByRole("region",{name:"Histórico de Linux operação"}).locator("canvas")).toHaveCount(1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({path:`.cache/screenshots/phase06-agent-${width}.png`,fullPage:true});
  });
}

test("infrastructure and Agent routes require login", async ({page}) => {
  for (const url of ["/infraestrutura","/hosts/linux-operacao"]) { await page.goto(url); await expect(page).toHaveURL(/\/login$/); }
});

test("VM detail opens in another tab with session and full selection", async ({page,context}) => {
  await start(page);
  const href = await page.getByRole("link",{name:"vm-operacao-1",exact:true}).getAttribute("href");
  const tab = await context.newPage(); await infrastructureFixture(tab); await tab.goto(href!);
  await expect(tab.getByLabel("Host ou VM do gráfico")).toHaveValue("vm-1");
  await expect(vmPanel(tab).locator("canvas")).toHaveCount(1); await tab.close();
});

test("touch and 200 percent zoom preserve detail controls and chart samples", async ({browser}) => {
  const context = await browser.newContext({baseURL:"http://127.0.0.1:3100",viewport:{width:1280,height:900},hasTouch:true,isMobile:true});
  const page = await context.newPage(); await start(page,"/asgard?hostKey=ASGARD&vm=vm-1");
  await expect(vmPanel(page).locator("canvas")).toHaveCount(1);
  await page.locator("body").evaluate(node => {node.style.zoom="2";});
  await expect(page.getByLabel("Host ou VM do gráfico")).toBeVisible();
  expect((await page.getByRole("button",{name:"7 dias",exact:true}).boundingBox())!.height).toBeGreaterThanOrEqual(44);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const table = page.getByRole("region",{name:"Máquinas virtuais do hipervisor"});
  expect(await table.evaluate(node => node.scrollWidth > node.clientWidth)).toBe(true);
  await vmPanel(page).getByRole("slider").fill("0");
  await expect(vmPanel(page).locator(".history-tooltip dd")).toHaveText("0%");
  await context.close();
});
