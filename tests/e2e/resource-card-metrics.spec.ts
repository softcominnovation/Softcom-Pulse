import { test, expect } from "@playwright/test";
import { adminFixture } from "../fixtures/admin";
import { signIn } from "../fixtures/infrastructure";
import { overview } from "../fixtures/dashboard";
import { resourceCardData } from "../fixtures/resource-card-data";
import { resolveAvailabilityCardMetrics } from "../../lib/monitoring/card-metrics";

for (const width of [390, 1366]) test(`resource trio persists through its single selector and reopens unchanged at ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: 900 });
  const state = await adminFixture(page), { resource, hosts } = resourceCardData("selected", ["cpu", "disk"]);
  state.service.infrastructure.hosts.splice(0, state.service.infrastructure.hosts.length, ...hosts); state.resources.push(resource.config);
  await signIn(page); await page.goto("/admin/recursos");
  const row = page.locator(".admin-saved-list > li").filter({ hasText: "Agenda" }); await row.getByRole("button", { name: "Editar", exact: true }).click();
  const editor = page.getByRole("region", { name: "Configuração do recurso", exact: true });
  await editor.getByLabel("Métricas do minicard", { exact: true }).selectOption("cpu,memory,disk");
  await expect(editor.locator(".availability-reading")).toHaveCount(3);
  await expect(editor.locator(".availability-reading").first()).toHaveText("Disco20%");
  expect((await editor.locator(".availability-card").boundingBox())!.height).toBe(140);
  expect((await editor.locator(".availability-card").boundingBox())!.width).toBeLessThanOrEqual(260);
  await editor.locator(".admin-resource-preview").screenshot({ path: `.cache/screenshots/trio-preview-${width}.png` });
  await editor.getByRole("button", { name: "Salvar recurso", exact: true }).click(); await expect(editor).toHaveCount(0);
  expect(state.writes.at(-1)!.body.presentation).toMatchObject({ cardMetrics: ["cpu", "memory", "disk"], showCpu: true, showMemory: true, showDisk: true });
  expect(state.resources.find(item => item.id === resource.id)!.agentMonitoring).toEqual(resource.config.agentMonitoring);
  await row.getByRole("button", { name: "Editar", exact: true }).click();
  await expect(editor.getByLabel("Métricas do minicard", { exact: true })).toHaveValue("cpu,memory,disk");
  await expect(editor.locator(".availability-reading").nth(2)).toHaveText("RAM40%");
});

for (const width of [390, 1366]) for (const mode of ["root", "selected", "missing", "legacy"] as const) test(`resource preview and dashboard retain the selected pair and disk source for ${mode} at ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: 900 });
  const state = await adminFixture(page), { resource, hosts } = resourceCardData(mode === "legacy" ? "root" : mode, ["cpu", "memory"]);
  if (mode === "legacy") { delete resource.config.presentation.cardMetrics; resource.config.presentation.showMemory = false; }
  state.service.infrastructure.hosts.splice(0, state.service.infrastructure.hosts.length, ...hosts);
  state.resources.push(resource.config);
  await signIn(page); await page.goto("/admin/recursos");
  const row = page.locator(".admin-saved-list > li").filter({ hasText: "Agenda" });
  await row.getByRole("button", { name: "Editar", exact: true }).click();
  const editor = page.getByRole("region", { name: "Configuração do recurso", exact: true });
  const preview = editor.locator(".admin-resource-preview .availability-card");
  await expect(editor.getByLabel("Métricas do minicard", { exact: true })).toHaveValue(mode === "legacy" ? "cpu,disk" : "cpu,memory");
  await expect(preview.locator(".availability-reading")).toHaveCount(2);
  await editor.getByLabel("Métricas do minicard", { exact: true }).selectOption("cpu,disk");
  const diskText = ["root", "legacy"].includes(mode) ? "Disco80%" : mode === "selected" ? "Disco20%" : "Disco—";
  await expect(preview.locator(".availability-reading").last()).toHaveText(diskText);
  await expect(preview.locator(".availability-reading").first()).toContainText("12,9%");
  for (const label of ["CPU", "Memória", "Disco"]) await expect(editor.getByRole("checkbox", { name: label, exact: true })).toHaveCount(0);
  await expect(preview.locator(".availability-reading")).toHaveCount(2);
  await expect(preview.locator(".availability-reading").last()).toHaveText(diskText);
  await editor.getByLabel("CPU e RAM do card", { exact: true }).selectOption("agent");
  await expect(preview.locator(".availability-reading").first()).toContainText("10,8%");
  await expect(preview.locator(".availability-reading").last()).toHaveText(diskText);
  await editor.getByLabel("CPU e RAM do card", { exact: true }).selectOption("hypervisor");
  const before = await preview.locator(".availability-reading").allTextContents();
  await preview.screenshot({ path: `.cache/screenshots/resource-card-${mode}-${width}.png` });
  expect(state.writes).toHaveLength(0);
  await editor.getByRole("button", { name: "Salvar recurso", exact: true }).click();
  await expect(editor).toHaveCount(0);
  expect(state.writes).toHaveLength(1);
  expect(state.writes[0].body.expectedRevision).toBe(1);
  expect(state.writes[0].body.presentation).toMatchObject({ cardMetrics: ["cpu", "disk"], showCpu: true, showMemory: false, showDisk: true });
  expect(state.writes[0].body).not.toHaveProperty("agentMonitoring");
  expect(state.resources.find(item => item.id === resource.id)!.agentMonitoring).toEqual(resource.config.agentMonitoring);
  await page.route("**/api/dashboard/overview*", route => {
    const result = overview(state.document);
    const config = state.resources.find(item => item.id === resource.id)!;
    const item = { ...resource, config, ...resolveAvailabilityCardMetrics({ ...resource, config }, hosts) };
    result.data.highlightedResources = [item];
    for (const block of result.data.blocks) if (block.type === "highlighted_resources") block.data = { cards: [{ kind: "resource", item }] };
    return route.fulfill({ json: result });
  });
  await page.goto("/");
  const card = page.getByRole("button", { name: /^Detalhes de Agenda:/ });
  await expect(card.locator(".availability-reading")).toHaveCount(2);
  expect(await card.locator(".availability-reading").allTextContents()).toEqual(before);
  await expect(card.locator(".availability-name")).toBeVisible(); await expect(card.locator(".availability-description")).toBeVisible();
  expect((await card.boundingBox())!.height).toBe(120);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test("a conflicting saved pair is edited through one control and stays coherent across saves", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 900 });
  const state = await adminFixture(page), { resource, hosts } = resourceCardData("selected", ["disk", "memory"]);
  Object.assign(resource.config.presentation, { showCpu: true, showMemory: false, showDisk: true });
  state.service.infrastructure.hosts.splice(0, state.service.infrastructure.hosts.length, ...hosts);
  state.resources.push(resource.config);
  await signIn(page); await page.goto("/admin/recursos");
  const row = page.locator(".admin-saved-list > li").filter({ hasText: "Agenda" });
  const editor = page.getByRole("region", { name: "Configuração do recurso", exact: true });
  let revision = 1;
  for (const pair of ["cpu,disk", "disk,memory", "cpu,disk"]) {
    await row.getByRole("button", { name: "Editar", exact: true }).click();
    for (const label of ["CPU", "Memória", "Disco"]) await expect(editor.getByRole("checkbox", { name: label, exact: true })).toHaveCount(0);
    await editor.getByLabel("Métricas do minicard", { exact: true }).selectOption(pair);
    await expect(editor.locator(".availability-reading").first()).toContainText(pair.startsWith("cpu") ? "CPU" : "Disco");
    await expect(editor.locator(".availability-reading").last()).toContainText(pair.endsWith("disk") ? "Disco" : "RAM");
    await editor.getByRole("button", { name: "Salvar recurso", exact: true }).click(); await expect(editor).toHaveCount(0);
    const write = state.writes.at(-1)!;
    expect(write.body.expectedRevision).toBe(revision++);
    expect(write.body.presentation).toMatchObject({ cardMetrics: pair.split(","), showCpu: pair.includes("cpu"), showMemory: pair.includes("memory"), showDisk: true });
    expect(state.resources.find(item => item.id === resource.id)!.agentMonitoring).toEqual(resource.config.agentMonitoring);
  }
  await row.getByRole("button", { name: "Editar", exact: true }).click();
  await expect(editor.getByLabel("Métricas do minicard", { exact: true })).toHaveValue("cpu,disk");
});
