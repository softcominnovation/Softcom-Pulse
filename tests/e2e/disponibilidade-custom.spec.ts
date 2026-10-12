import { test, expect } from "@playwright/test";
import { adminFixture } from "../fixtures/admin";
import { overview, id } from "../fixtures/dashboard";
import { signIn } from "../fixtures/infrastructure";
import { effectiveOptions } from "../../lib/config/presentation";
import type { AvailabilityPanelData } from "../../lib/monitoring/contracts";

test("admin saves custom availability cards and reloads order", async ({ page }) => {
  const state = await adminFixture(page);
  const resourceA = state.resources[0]!;
  const resourceB = state.resources[1] ?? { ...resourceA, id: id(8801), displayName: "Segundo recurso", enabled: true };
  if (!state.resources[1]) state.resources.push(resourceB as typeof resourceA);
  const appId = id(8802), vpsId = id(8803);
  await page.route("**/api/monitoring/external-services", route => route.fulfill({
    json: { data: [{ id: appId, revision: 1, secretConfigured: false, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), displayName: "App custom", description: null, serviceType: null, enabled: true, dashboardEnabled: false, critical: false, displayOrder: 0, method: "GET", url: "https://example.test", successMode: "http_status", expectedStatuses: [200], jsonPointer: null, timeoutMs: 5000, progressStartedAt: null }] },
  }));
  await page.route("**/api/monitoring/standalone-vps", route => route.fulfill({
    json: { data: [{ id: vpsId, name: "VPS custom", provider: null, ip: "1.2.3.4", domain: null, managerUrl: null, baseUrl: null, monitorConfigured: false, enabled: true, monitorPaused: false, dashboardEnabled: false, timeoutMs: 5000, revision: 1, monitorState: "unknown", reason: null, latencyMs: null, cpuPercent: null, memoryPercent: null, diskPercent: null, checkedAt: null, strip: [], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }] },
  }));
  await signIn(page); await page.goto("/admin/configuracoes");
  const block = page.getByRole("article", { name: "Serviços destacados na tela 1" });
  await block.getByLabel("Conteúdo do bloco").selectOption("custom");
  await expect(block.getByText("Nenhum card neste bloco", { exact: false })).toBeVisible();
  const resourceLabel = resourceA.displayName ?? resourceA.zabbixHostKey;
  // Catalog checkboxes are one-shot add controls (always rendered unchecked).
  await block.getByRole("region", { name: "Recursos Zabbix" }).getByRole("checkbox", { name: `Zabbix · ${resourceLabel}` }).click();
  await block.getByRole("region", { name: "Aplicações" }).getByRole("checkbox", { name: "Aplicação · App custom" }).click();
  await block.getByRole("region", { name: "VPS avulsas" }).getByRole("checkbox", { name: "VPS · VPS custom" }).click();
  await block.getByRole("button", { name: "Mover Aplicação · App custom para cima" }).click();
  await page.getByRole("button", { name: "Salvar apresentação", exact: true }).click();
  await expect.poll(() => state.document.revision).toBe(2);
  const saved = state.document.screens[0].blocks.find(item => item.type === "highlighted_resources")!;
  expect(saved.options).toMatchObject({
    selection: "custom",
    cards: [`external_service:${appId}`, `resource:${resourceA.id}`, `standalone_vps:${vpsId}`],
  });
  await page.reload();
  const reloaded = page.getByRole("article", { name: "Serviços destacados na tela 1" });
  await expect(reloaded.getByLabel("Conteúdo do bloco")).toHaveValue("custom");
  const order = reloaded.locator("[aria-label='Cards do bloco'] li");
  await expect(order).toHaveCount(3);
  await expect(order.nth(0)).toContainText("App custom");
  await expect(order.nth(1)).toContainText(resourceA.displayName ?? resourceA.zabbixHostKey);
  await expect(order.nth(2)).toContainText("VPS custom");
});

test("dashboard renders distinct default vs custom availability blocks without breaking split layout", async ({ page }) => {
  const state = await adminFixture(page);
  const screen = state.document.screens[0];
  screen.overviewGrid = "split";
  const defaultBlock = screen.blocks.find(block => block.type === "highlighted_resources")!;
  defaultBlock.options = effectiveOptions({ type: "highlighted_resources", options: { selection: "default", visibleRows: 2 } });
  const customId = id(8901);
  screen.blocks.push({
    id: customId, type: "highlighted_resources", width: "full", enabled: false,
    options: effectiveOptions({
      type: "highlighted_resources",
      options: { selection: "custom", visibleRows: 2, cards: [`resource:${state.service.services[0]!.id}`] },
    }),
  });
  // Enable custom on a second screen so both modes are exercised via screen switch.
  state.document.screens.push({
    id: id(8902), name: "Custom", enabled: true, layout: "overview", overviewGrid: "split",
    blocks: [
      { id: id(8903), type: "summary", width: "full", enabled: true, options: effectiveOptions({ type: "summary" }) },
      {
        id: id(8904), type: "highlighted_resources", width: "full", enabled: true,
        options: effectiveOptions({
          type: "highlighted_resources",
          options: { selection: "custom", visibleRows: 2, cards: [`resource:${state.service.services[0]!.id}`] },
        }),
      },
      { id: id(8905), type: "asgard_summary", width: "wide", enabled: true, options: effectiveOptions({ type: "asgard_summary" }) },
      { id: id(8906), type: "problems", width: "wide", enabled: true, options: effectiveOptions({ type: "problems" }) },
    ],
  });

  await page.route("**/api/dashboard/overview*", route => {
    const screenId = new URL(route.request().url()).searchParams.get("screenId") ?? state.document.screens[0].id;
    const data = overview(state.document, screenId);
    const resource = state.service.services[0]!;
    const second = state.service.services[1] ?? resource;
    for (const block of data.data.blocks.filter(item => item.type === "highlighted_resources")) {
      const options = (state.document.screens.find(item => item.id === screenId)?.blocks.find(item => item.id === block.blockId)?.options
        ?? effectiveOptions({ type: "highlighted_resources" })) as { selection?: string };
      const panel: AvailabilityPanelData = options.selection === "custom"
        ? { cards: [{ kind: "resource", item: resource }] }
        : { cards: [{ kind: "resource", item: resource }, { kind: "resource", item: second }] };
      Object.assign(block, { options: state.document.screens.find(item => item.id === screenId)?.blocks.find(item => item.id === block.blockId)?.options, data: panel });
    }
    return route.fulfill({ json: data });
  });

  await page.setViewportSize({ width: 1440, height: 900 });
  await signIn(page);
  await page.goto("/");
  await expect(page.locator(".block-highlighted_resources .availability-card")).toHaveCount(2);
  await expect(page.locator(".overview-split-grid")).toBeVisible();
  const splitBefore = await page.locator(".overview-split-grid").boundingBox();
  await page.getByLabel("Escolher tela").selectOption({ label: "Custom" });
  await expect(page.locator(".block-highlighted_resources .availability-card")).toHaveCount(1);
  await expect(page.locator(".overview-split-grid")).toBeVisible();
  const splitAfter = await page.locator(".overview-split-grid").boundingBox();
  expect(splitAfter?.width).toBeCloseTo(splitBefore?.width ?? 0, 0);
});
