import { test, expect } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { adminFixture } from "../fixtures/admin";
import { signIn } from "../fixtures/infrastructure";
import { id } from "../fixtures/dashboard";

test("resources preview discovered targets, preserve draft on conflict and require confirmed deletion", async ({ page }) => {
  const state = await adminFixture(page); await signIn(page); await page.goto("/admin/recursos");
  await page.getByRole("button", { name: "Configurar ASGARD", exact: true }).click();
  await page.getByLabel("Nome amigável").fill("Servidor principal");
  await expect(page.locator(".admin-resource-preview")).toContainText("Servidor principal");
  state.resourceConflict = true; await page.getByRole("button", { name: "Salvar recurso" }).click();
  await expect(page.locator(".admin-error[role=alert]")).toContainText("Já existe"); await expect(page.getByLabel("Nome amigável")).toHaveValue("Servidor principal");
  state.resourceConflict = false; await page.getByRole("button", { name: "Salvar recurso" }).click();
  await expect(page.locator(".admin-saved-list")).toContainText("Servidor principal");
  const row = page.locator(".admin-saved-list > li").filter({ hasText: "Servidor principal" });
  await row.getByRole("button", { name: "Remover", exact: true }).click(); await page.getByRole("button", { name: "Cancelar", exact: true }).click();
  expect(state.writes.filter(item => item.method === "DELETE")).toHaveLength(0);
  await row.getByRole("button", { name: "Remover", exact: true }).click(); await page.getByRole("button", { name: "Remover configuração", exact: true }).click();
  await expect(row).toHaveCount(0); expect(state.writes.filter(item => item.method === "DELETE")).toHaveLength(1);
});
test("container selectors show all ambiguous candidates and health history requires health visibility", async ({ page }) => {
  const state = await adminFixture(page); state.service.containers[0].name = "swarm_app.1.abcdef";
  state.service.containers[1].name = "swarm_app.2.abcdef";
  await signIn(page); await page.goto("/admin/recursos");
  await page.getByRole("button", { name: "Configurar swarm_app.1.abcdef", exact: true }).click();
  await expect(page.getByLabel("Correspondência do nome")).toHaveValue("name_prefix"); await expect(page.getByLabel("Seletor", { exact: true })).toHaveValue("swarm_app");
  await expect(page.locator(".admin-candidates")).toContainText("2 candidato(s)"); await expect(page.getByRole("button", { name: "Salvar recurso" })).toBeDisabled();
  await page.getByLabel("Correspondência do nome").selectOption("exact_name"); await page.getByLabel("Seletor", { exact: true }).fill("swarm_app.1.abcdef");
  await page.getByLabel("Histórico de healthcheck", { exact: true }).check(); await page.getByRole("button", { name: "Salvar recurso" }).click();
  await expect(page.locator(".admin-error[role=alert]")).toContainText("exige healthcheck"); expect(state.writes).toHaveLength(0);
  await page.getByLabel("Healthcheck", { exact: true }).check(); await page.getByLabel("Janela do histórico de healthcheck").selectOption("24h"); await page.getByRole("button", { name: "Salvar recurso" }).click();
  await expect.poll(() => state.writes.length).toBe(1); expect((state.writes[0].body.presentation as Record<string, unknown>).healthTimelineRange).toBe("24h");
});
test("presentation reorders and moves blocks preserving identities, previews without writes and persists options", async ({ page }) => {
  const state = await adminFixture(page), original = state.document.screens[0].blocks[2].id;
  await signIn(page); await page.goto("/admin/configuracoes");
  const screen = page.getByRole("region", { name: "Tela 1", exact: true });
  const asgard = page.getByRole("article", { name: "ASGARD e VMs na tela 1" });
  await asgard.getByLabel("Ordenar por").selectOption("cpu"); await asgard.getByLabel("Direção").selectOption("desc"); await asgard.getByLabel("Linhas visíveis").selectOption("3");
  await screen.getByRole("button", { name: "Ver prévia" }).click(); await expect(page.getByRole("region", { name: "Prévia da composição" })).toContainText("armazenamento & VMs"); expect(state.writes).toHaveLength(0);
  await page.getByRole("button", { name: "Adicionar tela", exact: true }).click();
  await asgard.getByLabel("Associado à tela").selectOption({ label: "Tela 2" });
  await page.getByRole("button", { name: "Salvar apresentação", exact: true }).click(); await expect.poll(() => state.document.revision).toBe(2);
  expect(state.document.screens[1].blocks[1].id).toBe(original); expect(state.document.screens[1].blocks[1].options).toMatchObject({ sortBy: "cpu", sortDirection: "desc", visibleRows: 3 });
  await page.reload(); await expect(page.getByRole("article", { name: "ASGARD e VMs na tela 2" }).getByLabel("Ordenar por")).toHaveValue("cpu");
});
test("revision conflicts retain drafts, screen limits are explicit and reload requires confirmation", async ({ page }) => {
  const state = await adminFixture(page); await signIn(page); await page.goto("/admin/configuracoes");
  await page.getByLabel("Nome da tela").fill("Rascunho preservado"); state.presentationConflict = true;
  await page.getByRole("button", { name: "Salvar apresentação", exact: true }).click(); await expect(page.locator(".admin-error[role=alert]")).toContainText("outra sessão"); await expect(page.getByLabel("Nome da tela")).toHaveValue("Rascunho preservado");
  await page.getByRole("button", { name: "Recarregar para revisar", exact: true }).click(); await page.getByRole("dialog").getByRole("button", { name: "Cancelar", exact: true }).click(); await expect(page.getByLabel("Nome da tela")).toHaveValue("Rascunho preservado");
  await page.getByRole("button", { name: "Recarregar para revisar", exact: true }).click(); await page.getByRole("button", { name: "Recarregar apresentação", exact: true }).click(); await expect(page.getByLabel("Nome da tela")).toHaveValue("Visão geral");
  await page.getByRole("button", { name: "Adicionar tela", exact: true }).click(); await page.getByRole("button", { name: "Adicionar tela", exact: true }).click(); await expect(page.getByRole("button", { name: "Adicionar tela", exact: true })).toBeDisabled();
});
test("templates save independent preferences, handle conflict, and edit orphan settings offline", async ({ page }) => {
  const state = await adminFixture(page); await signIn(page); await page.goto("/admin/configuracoes");
  await page.getByRole("button", { name: "Editar template tpl-worker-ubuntu-24", exact: true }).click(); await page.getByLabel("Nome amigável").fill("Worker de aplicações"); await page.getByLabel("Papel", { exact: true }).selectOption("manager");
  state.templateConflict = true; await page.getByRole("button", { name: "Salvar template" }).click(); await expect(page.locator(".admin-error[role=alert]")).toContainText("outra sessão"); await expect(page.getByLabel("Nome amigável")).toHaveValue("Worker de aplicações");
  state.templateConflict = false; await page.getByRole("button", { name: "Salvar template" }).click(); await expect.poll(() => state.preferences.length).toBe(1);
  expect(state.preferences[0].roleOverride).toBe("manager");
  state.templates = []; state.templatesFail = true; await page.getByRole("button", { name: "Atualizar templates", exact: true }).click();
  await page.reload(); await page.getByRole("button", { name: "Editar preferência", exact: true }).click(); await page.getByLabel("Nome amigável").fill("Nome preservado sem coleta"); await page.getByRole("button", { name: "Salvar template" }).click(); await expect.poll(() => state.preferences[0].revision).toBe(2);
  await page.getByRole("button", { name: "Editar preferência", exact: true }).click(); await page.getByRole("button", { name: "Restaurar automático", exact: true }).click(); await page.getByRole("dialog").getByRole("button", { name: "Cancelar", exact: true }).click(); expect(state.preferences[0].displayName).toBe("Nome preservado sem coleta");
  await page.getByRole("button", { name: "Restaurar automático", exact: true }).click(); await page.getByRole("dialog").getByRole("button", { name: "Restaurar automático", exact: true }).click(); await expect.poll(() => state.preferences[0].displayName).toBe(null);
});
for (const width of [320, 390, 768, 1366, 1920, 2560, 3440]) test(`admin controls and real preview stay usable at ${width}px`, async ({ page }) => {
  const state = await adminFixture(page); await page.setViewportSize({ width, height: width >= 1920 ? 1080 : 800 }); await signIn(page); await page.goto("/admin/configuracoes");
  await expect(page.getByRole("heading", { name: "Configurações da visualização" })).toBeVisible();
  await page.getByRole("button", { name: "Ver prévia", exact: true }).click(); await expect(page.getByRole("region", { name: "Prévia da composição" })).toContainText("armazenamento & VMs");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
  await page.getByRole("button", { name: "Remover bloco", exact: true }).first().click(); const dialog = page.getByRole("dialog"); await expect(dialog.getByRole("button", { name: "Cancelar" })).toBeFocused(); await page.keyboard.press("Escape"); expect(state.writes).toHaveLength(0);
  await mkdir(".cache", { recursive: true }); await page.screenshot({ path: `.cache/phase08-admin-${width}.png`, fullPage: width === 1366 || width === 390 });
});

test("legacy over-limit composition is preserved until explicitly adjusted, and an empty filter stays editable", async ({ page }) => {
  const state = await adminFixture(page); state.document.schemaVersion = 1;
  state.document.screens[0].blocks = Array.from({ length: 7 }, (_, index) => ({ id: id(8000 + index), type: "summary", width: "full", enabled: true }));
  await signIn(page); await page.goto("/admin/configuracoes");
  await expect(page.getByText("Esta composição antiga", { exact: false })).toBeVisible(); await page.getByRole("button", { name: "Salvar apresentação" }).click(); expect(state.writes).toHaveLength(0);
  await page.getByLabel("Bloco habilitado", { exact: true }).last().uncheck(); await page.getByRole("button", { name: "Salvar apresentação" }).click(); await expect.poll(() => state.document.schemaVersion).toBe(2);
  expect(state.document.screens[0].blocks).toHaveLength(7); expect(state.document.screens[0].blocks[6].id).toBe(id(8006));
  const first = page.getByRole("article").first();
  for (const label of ["Hosts monitorados", "Containers em execução", "Containers parados"]) await first.getByLabel(label, { exact: true }).uncheck();
  await expect(first.getByLabel("Problemas ativos", { exact: true })).toBeDisabled();
  await first.getByLabel("Jobs aguardando", { exact: true }).check();
  await first.getByLabel("Problemas ativos", { exact: true }).uncheck();
  await page.getByRole("button", { name: "Salvar apresentação" }).click(); await expect.poll(() => state.document.revision).toBe(3);
  expect(state.document.screens[0].blocks[0].options?.indicators).toEqual(["jobs_waiting"]);
});
test("existing resource preferences remain editable without discovery and keep the UUID", async ({ page }) => {
  const state = await adminFixture(page), resourceId = state.resources[0].id;
  state.service.fail = true; state.service.infrastructure.hostsFailed = true;
  await signIn(page); await page.goto("/admin/recursos");
  await expect(page.getByText("Associação sem evidência atual").first()).toBeVisible(); await page.locator(".admin-saved-list > li").first().getByRole("button", { name: "Editar", exact: true }).click();
  await page.getByLabel("Nome amigável").fill("Preferência sem coleta"); await page.getByRole("button", { name: "Salvar recurso" }).click(); await expect.poll(() => state.resources[0].displayName).toBe("Preferência sem coleta");
  expect(state.resources[0].id).toBe(resourceId); expect(state.writes[0].method).toBe("PATCH");
});
test("pending saves prevent duplicate submission and admin routes require a session", async ({ page }) => {
  await page.goto("/admin/recursos"); await expect(page).toHaveURL(/\/login/);
  const state = await adminFixture(page); await signIn(page); await page.goto("/admin/configuracoes");
  let release!: () => void; state.wait = new Promise(resolve => { release = resolve; });
  await page.getByRole("button", { name: "Salvar apresentação" }).click(); await expect(page.getByRole("button", { name: "Salvando…" })).toBeDisabled();
  expect(state.writes).toHaveLength(1); release(); state.wait = null; await expect.poll(() => state.document.revision).toBe(2);
});
test("touch resources and zoomed confirmations retain fields, actions and keyboard focus", async ({ page }) => {
  const state = await adminFixture(page); await page.setViewportSize({ width: 390, height: 844 }); await signIn(page); await page.goto("/admin/recursos");
  await page.getByRole("button", { name: "Configurar ASGARD", exact: true }).click(); await page.getByLabel("Nome amigável").fill("Nome extenso para conferência das configurações do recurso");
  const overflow = await page.evaluate(() => ({ width: document.documentElement.scrollWidth, viewport: innerWidth, items: Array.from(document.querySelectorAll(".admin-page *")).filter(item => item.getBoundingClientRect().right > innerWidth && !item.closest(".admin-table-scroll")).map(item => ({ tag: item.tagName, class: item.className, width: item.getBoundingClientRect().width, right: item.getBoundingClientRect().right })) }));
  expect(overflow.width, JSON.stringify(overflow)).toBeLessThanOrEqual(overflow.viewport + 1);
  await page.screenshot({ path: ".cache/phase08-resources-mobile.png", fullPage: true });
  await page.setViewportSize({ width: 1366, height: 900 }); await page.evaluate(() => { document.documentElement.style.zoom = "2"; });
  const remove = page.locator(".admin-saved-list > li").first().getByRole("button", { name: "Remover", exact: true }); await remove.click();
  const dialog = page.getByRole("dialog"), box = await dialog.boundingBox(); expect(box!.x).toBeGreaterThanOrEqual(0); expect(box!.y).toBeGreaterThanOrEqual(0); expect(box!.x + box!.width).toBeLessThanOrEqual(1367); expect(box!.y + box!.height).toBeLessThanOrEqual(901);
  await expect(dialog.getByRole("button", { name: "Cancelar", exact: true })).toBeFocused(); await page.keyboard.press("Escape"); await expect(remove).toBeFocused(); expect(state.writes).toHaveLength(0);
});
