import { test, expect, type Page, type Route } from "@playwright/test";
import { adminFixture } from "../fixtures/admin";
import { infrastructureFixture, signIn } from "../fixtures/infrastructure";
import { id, overview, presentation } from "../fixtures/dashboard";

type Stack = { id: string; vpsId: string; name: string; link: string | null; notes: string | null; createdAt: string; updatedAt: string };
type Row = {
  id: string; name: string; provider: string | null; ip: string; domain: string | null; managerUrl: string | null; baseUrl: string | null;
  monitorConfigured: boolean; enabled: boolean; dashboardEnabled: boolean; timeoutMs: number; revision: number; monitorState: string;
  reason: number | null; latencyMs: number | null; cpuPercent: number | null; memoryPercent: number | null; diskPercent: number | null;
  checkedAt: string | null; strip: number[]; createdAt: string; updatedAt: string; stacks: Stack[]; apiKey: string | null; monitorPaused: boolean;
};

function card(row: Row) {
  const { stacks, ...publicCard } = row;
  void stacks;
  return publicCard;
}
function detail(row: Row, range = "24h") {
  return { ...card(row), stacks: row.stacks, result: null, samples: [], range };
}
async function installVps(page: Page) {
  const at = new Date().toISOString();
  let sequence = 80;
  const rows: Row[] = [];
  const writes: { method: string; path: string; body: Record<string, unknown> | null }[] = [];
  const record = (route: Route) => {
    const request = route.request();
    writes.push({ method: request.method(), path: new URL(request.url()).pathname, body: request.method() === "GET" ? null : request.postDataJSON() as Record<string, unknown> });
  };
  const stateOf = (row: Row) => !row.enabled ? "inactive" : row.monitorConfigured ? "pending" : "not_configured";
  await page.route("**/api/monitoring/standalone-vps", async route => {
    const request = route.request();
    if (request.method() === "GET") return route.fulfill({ json: { data: rows.map(card) } });
    record(route);
    const body = request.postDataJSON() as Record<string, unknown>;
    const row: Row = {
      id: id(sequence++), name: String(body.name), provider: (body.provider as string | null) ?? null, ip: String(body.ip), domain: (body.domain as string | null) ?? null,
      managerUrl: (body.managerUrl as string | null) ?? null, baseUrl: (body.baseUrl as string | null) ?? null, monitorConfigured: Boolean(body.baseUrl && body.apiKey),
      enabled: body.enabled !== false, dashboardEnabled: body.dashboardEnabled === true, timeoutMs: Number(body.timeoutMs ?? 5000), revision: 1, monitorState: "not_configured",
      reason: null, latencyMs: null, cpuPercent: null, memoryPercent: null, diskPercent: null, checkedAt: null, strip: [], createdAt: at, updatedAt: at, stacks: [], apiKey: typeof body.apiKey === "string" && body.apiKey ? body.apiKey : null, monitorPaused: false,
    };
    row.monitorState = stateOf(row);
    rows.push(row);
    return route.fulfill({ status: 201, json: { data: card(row) } });
  });
  await page.route("**/api/monitoring/standalone-vps/*", async route => {
    const request = route.request();
    const parts = new URL(request.url()).pathname.split("/").filter(Boolean);
    const key = parts[3];
    const row = rows.find(item => item.id === key);
    if (!row) return route.fulfill({ status: 404, json: { error: { code: "standalone_vps_not_found" } } });
    if (request.method() === "GET") return route.fulfill({ json: { data: detail(row, new URL(request.url()).searchParams.get("range") ?? "24h") } });
    record(route);
    if (request.method() === "DELETE") {
      rows.splice(rows.indexOf(row), 1);
      return route.fulfill({ status: 204 });
    }
    const body = request.postDataJSON() as Record<string, unknown>;
    const { apiKey: nextKey, expectedRevision, ...changes } = body;
    void expectedRevision;
    Object.assign(row, changes, { revision: row.revision + 1, updatedAt: at });
    if (typeof nextKey === "string") row.apiKey = nextKey || row.apiKey;
    if ("baseUrl" in body && !row.baseUrl) row.apiKey = null;
    if ("baseUrl" in body) row.monitorConfigured = Boolean(row.baseUrl && row.apiKey);
    if (typeof body.monitorPaused === "boolean") row.monitorPaused = body.monitorPaused;
    if (row.monitorPaused || body.monitorPaused === false) row.strip = [];
    row.monitorState = row.monitorPaused ? "paused" : stateOf(row);
    return route.fulfill({ json: { data: card(row) } });
  });
  await page.route("**/api/monitoring/standalone-vps/*/stacks", async route => {
    record(route);
    const key = new URL(route.request().url()).pathname.split("/").filter(Boolean)[3];
    const row = rows.find(item => item.id === key)!;
    const body = route.request().postDataJSON() as { name: string; link: string | null; notes: string | null };
    const stack: Stack = { id: id(sequence++), vpsId: row.id, name: body.name, link: body.link, notes: body.notes, createdAt: at, updatedAt: at };
    row.stacks.push(stack);
    return route.fulfill({ status: 201, json: { data: stack } });
  });
  return { rows, writes };
}

test("vps list keeps catalog fields and treats a missing monitor as gray", async ({ page }) => {
  await adminFixture(page);
  const { writes } = await installVps(page);
  const managerCalls: string[] = [];
  page.on("request", request => { if (request.url().includes("manager.example")) managerCalls.push(request.url()); });
  await signIn(page);
  await page.goto("/admin/vps");
  await expect(page.getByRole("heading", { name: "VPS", exact: true })).toBeVisible();
  await expect(page.getByText("Ainda não há VPS. Use o botão Nova VPS para cadastrar a primeira.")).toBeVisible();
  await page.getByRole("button", { name: "Nova VPS", exact: true }).click();
  const keyInput = page.getByLabel("Chave da API", { exact: true });
  const keyToggle = page.getByRole("button", { name: "Mostrar chave", exact: true });
  const keyBox = await keyInput.boundingBox();
  const toggleBox = await keyToggle.boundingBox();
  expect(keyBox && toggleBox && toggleBox.x > keyBox.x && toggleBox.x + toggleBox.width <= keyBox.x + keyBox.width + 1 && Math.abs(toggleBox.y - keyBox.y) < 6).toBe(true);
  await page.getByLabel("Nome", { exact: true }).fill("Orbit");
  await page.getByLabel("Provedor", { exact: true }).fill("Hostinger");
  await page.getByLabel("Endereço IP", { exact: true }).fill("10.1.1.8");
  await page.getByLabel("Domínio", { exact: true }).fill("orbit.example");
  await page.getByLabel("URL do manager", { exact: true }).fill("https://manager.example/vps");
  await page.getByRole("button", { name: "Salvar VPS", exact: true }).click();
  const card = page.locator(".vps-card");
  await expect(card).toContainText("Orbit");
  await expect(card).toContainText("Hostinger");
  await expect(card).toContainText("10.1.1.8");
  await expect(card).toContainText("orbit.example");
  await expect(card).toContainText("Disponível");
  await expect(card).toContainText("Monitor não cadastrado");
  await expect(card.locator(".uptime-strip rect")).toHaveCount(40);
  await expect(card.locator(".uptime-strip rect[opacity='0.35']")).toHaveCount(40);
  const manager = card.getByRole("link", { name: "Abrir manager", exact: true });
  await expect(manager).toHaveAttribute("href", "https://manager.example/vps");
  await expect(manager).toHaveAttribute("target", "_blank");
  expect(managerCalls).toEqual([]);
  await page.getByLabel("Buscar", { exact: true }).fill("inexistente");
  await expect(page.getByText("Nenhuma VPS corresponde à busca.")).toBeVisible();
  await page.getByLabel("Buscar", { exact: true }).fill("");
  const before = writes.length;
  await page.getByRole("button", { name: "Inativar Orbit", exact: true }).click();
  await expect(page.getByRole("dialog")).toContainText("Nenhum recurso do Zabbix será alterado.");
  await page.getByRole("button", { name: "Cancelar", exact: true }).click();
  expect(writes).toHaveLength(before);
  await expect(card).toContainText("Disponível");
  await expect(card.getByRole("link", { name: "Detalhes", exact: true })).toHaveAttribute("href", /\/admin\/vps\/00000000-0000-4000-8000-000000000080$/);
  await card.getByRole("link", { name: "Orbit", exact: true }).click();
  await expect(page).toHaveURL(/\/admin\/vps\/00000000-0000-4000-8000-000000000080$/);
  expect(new URL(page.url()).search).toBe("");
  const detail = page.getByRole("region", { name: "Orbit", exact: true });
  await expect(detail).toContainText("Hostinger");
  await expect(detail).toContainText("10.1.1.8 · orbit.example");
  await expect(detail).toContainText("Disponível");
  await expect(detail).toContainText("Monitor não cadastrado");
  await expect(detail.locator(".uptime-track rect[opacity='0.35']")).toHaveCount(40);
  await expect(detail.locator(".meter-value")).toHaveCount(0);
  const text = await page.locator("main").innerText();
  for (const forbidden of ["Fora do ar", "Indisponível", "Atenção", "Sem dados"]) expect(text).not.toContain(forbidden);
  await page.getByRole("button", { name: "Editar", exact: true }).click();
  await expect(page.getByLabel("Endereço IP", { exact: true })).toHaveValue("10.1.1.8");
  await expect(page.getByLabel("Provedor", { exact: true })).toHaveValue("Hostinger");
  await expect(page.getByLabel("URL do manager", { exact: true })).toHaveValue("https://manager.example/vps");
  await page.getByLabel("Domínio", { exact: true }).fill("orbit.editado");
  await page.getByLabel("URL base do monitor", { exact: true }).fill("https://monitor.example");
  await page.getByLabel("Chave da API", { exact: true }).fill("chave-salva");
  await page.getByRole("button", { name: "Salvar VPS", exact: true }).click();
  await expect(detail).toContainText("10.1.1.8 · orbit.editado");
  await page.getByRole("button", { name: "Editar", exact: true }).click();
  await expect(page.getByLabel("Chave da API", { exact: true })).toHaveValue("chave-salva");
  await expect(page.getByRole("button", { name: "Pausar monitor", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Cancelar", exact: true }).click();
  const beforePause = writes.length;
  await page.getByRole("button", { name: "Pausar monitor", exact: true }).click();
  await page.getByRole("button", { name: "Cancelar", exact: true }).click();
  expect(writes).toHaveLength(beforePause);
  await page.getByRole("button", { name: "Pausar monitor", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Pausar monitor", exact: true }).click();
  await expect(detail).toContainText("Pausada");
  await expect(detail.locator(".uptime-track rect[opacity='0.35']")).toHaveCount(40);
  await page.getByRole("button", { name: "Novo serviço", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Nome", { exact: true }).fill("Portainer");
  const notes = dialog.getByLabel("Anotações", { exact: true });
  await notes.fill("Produção no host 1");
  const notesBox = await notes.boundingBox();
  const dialogBox = await dialog.boundingBox();
  expect(notesBox && dialogBox && notesBox.width > dialogBox.width * 0.7).toBe(true);
  await dialog.getByRole("button", { name: "Salvar serviço", exact: true }).click();
  const stack = page.getByRole("region", { name: "Serviços", exact: true });
  await expect(stack).toContainText("Portainer");
  await expect(stack).not.toContainText("Produção no host 1");
  await stack.getByRole("button", { name: "Ver anotações de Portainer", exact: true }).click();
  await expect(page.getByRole("dialog")).toContainText("Produção no host 1");
  expect(managerCalls).toEqual([]);
});

test("highlighted vps card keeps the availability size and opens its detail", async ({ page }) => {
  await infrastructureFixture(page);
  const at = new Date().toISOString();
  const vpsId = id(90);
  const row: Row = {
    id: vpsId, name: "Orbit", provider: "Oracle", ip: "10.2.2.2", domain: null, managerUrl: null, baseUrl: null, monitorConfigured: false, enabled: true, dashboardEnabled: true,
    timeoutMs: 5000, revision: 1, monitorState: "not_configured", reason: null, latencyMs: null, cpuPercent: null, memoryPercent: null, diskPercent: null, checkedAt: null, strip: [],
    createdAt: at, updatedAt: at, stacks: [], apiKey: null, monitorPaused: false,
  };
  const body = overview(presentation());
  const live: Row = {
    ...row, id: id(91), name: "SoftcomIA Bot", baseUrl: "https://monitor.example", monitorConfigured: true, monitorState: "up", reason: 0,
    cpuPercent: 6.9, memoryPercent: 26, diskPercent: 18.6, checkedAt: at, strip: Array.from({ length: 8 }, () => 0),
  };
  body.data.standaloneVps = [card(row), card(live)].map(item => item as NonNullable<typeof body.data.standaloneVps>[number]);
  await page.route("**/api/dashboard/overview*", route => route.fulfill({ json: body }));
  await page.route("**/api/monitoring/standalone-vps/*", route => route.fulfill({ json: { data: detail(row) } }));
  await signIn(page);
  await page.setViewportSize({ width: 1280, height: 800 });
  const highlight = page.getByRole("button", { name: "Detalhes de Orbit: Monitor não cadastrado, disponibilidade —", exact: true });
  await expect(highlight).toBeVisible();
  await expect(highlight.locator(".availability-footer")).toContainText("VPS · 10.2.2.2");
  await expect(highlight.locator(".availability-footer strong")).toHaveText("—");
  const box = await highlight.boundingBox();
  expect(box?.width).toBeLessThanOrEqual(230.1);
  expect(box?.height).toBeCloseTo(120, 0);
  await expect(highlight.locator("rect")).toHaveCount(40);
  await page.getByRole("button", { name: /Detalhes de SoftcomIA Bot/ }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByText("CPU", { exact: true })).toBeVisible();
  await expect(dialog.getByText("RAM", { exact: true })).toBeVisible();
  await expect(dialog.getByText("Disco", { exact: true })).toBeVisible();
  await expect(dialog.getByText("6,9%")).toBeVisible();
  await expect(dialog.getByText("26%")).toBeVisible();
  await expect(dialog.getByText("18,6%")).toBeVisible();
  await expect(dialog.locator(".vps-snapshot .meter-value")).toHaveCount(3);
  await expect(dialog.getByText(/Núcleo/)).toHaveCount(0);
  await page.keyboard.press("Escape");
  await highlight.click();
  await page.getByRole("link", { name: "Abrir em VPS", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/admin/vps/${vpsId}$`));
  expect(new URL(page.url()).search).toBe("");
  await expect(page.getByRole("region", { name: "Orbit", exact: true })).toContainText("Monitor não cadastrado");
});

test("menu order keeps presentation links and parks screen rotation with the indicators", async ({ page }) => {
  await infrastructureFixture(page);
  await signIn(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  const labels = await page.locator(".monitoring-nav a").evaluateAll(nodes => nodes.map(node => node.textContent?.trim()));
  expect(labels).toEqual(["Visão geral", "Infraestrutura", "Asgard & VMs", "VPS", "Serviços", "Aplicações", "Recursos", "Configurações"]);
  const rotate = page.getByRole("button", { name: "Alternar telas", exact: true });
  const screenLabel = page.locator(".screen-controls label");
  await expect(rotate).toBeVisible();
  const rotateBox = await rotate.boundingBox();
  const labelBox = await screenLabel.boundingBox();
  expect(rotateBox && labelBox && rotateBox.x < labelBox.x && Math.abs((rotateBox.y + rotateBox.height / 2) - (labelBox.y + labelBox.height / 2)) < 12).toBe(true);
  await page.getByRole("button", { name: "Modo TV", exact: true }).click();
  for (const name of ["VPS", "Aplicações", "Recursos", "Configurações"]) await expect(page.getByRole("link", { name, exact: true })).toBeHidden();
  for (const name of ["Visão geral", "Infraestrutura", "Asgard & VMs", "Serviços"]) await expect(page.getByRole("link", { name, exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Sair do modo TV", exact: true }).click();
  await page.getByRole("button", { name: "Tela cheia", exact: true }).click();
  await expect(page.getByRole("link", { name: "VPS", exact: true })).toBeHidden();
  await expect(page.getByRole("link", { name: "Visão geral", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Serviços", exact: true })).toBeVisible();
});
