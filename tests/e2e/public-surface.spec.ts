import { test, expect } from "@playwright/test";
import { overview, presentation } from "../fixtures/dashboard";
import { effectiveOptions } from "../../lib/config/presentation";

const at = new Date().toISOString();
const envelope = <T>(data: T) => ({ data, availability: "ready" as const, stale: false, lastUpdated: at, refreshAfterMs: 20000 });

async function mockPublicShell(page: import("@playwright/test").Page) {
  const document = presentation(1, 1);
  document.schemaVersion = 2;
  for (const block of document.screens[0].blocks) block.options = effectiveOptions({ type: block.type });
  const body = overview(document);
  const hypervisor = body.data.asgardSummary.host!;
  await page.route("**/api/public/settings/presentation", route => route.fulfill({ json: { data: document, updatedAt: at } }));
  await page.route("**/api/public/dashboard/overview*", route => route.fulfill({ json: body }));
  await page.route("**/api/public/monitoring/hosts", route => route.fulfill({ json: { ...envelope([hypervisor]), asgardHostKey: hypervisor.hostKey } }));
  await page.route("**/api/public/monitoring/problems", route => route.fulfill({ json: envelope(body.data.problems) }));
  await page.route("**/api/public/monitoring/services", route => route.fulfill({ json: envelope([]) }));
  await page.route("**/api/public/monitoring/signal-targets", route => route.fulfill({ json: { data: [] } }));
  await page.route("**/api/public/monitoring/containers**", route => route.fulfill({ status: 404, json: { error: { code: "not_found" } } }));
  await page.route("**/api/public/monitoring/hosts/**/containers", route => route.fulfill({ status: 404, json: { error: { code: "not_found" } } }));
  return { hypervisor };
}

test("public services hide container inventory and menu omits Recursos", async ({ page }) => {
  await mockPublicShell(page);
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.goto("/monitor/servicos");
  await expect(page.getByRole("heading", { name: "Softcom Signal" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Inventário de containers" })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Recursos configurados" })).toBeVisible();
  const labels = await page.locator(".monitoring-nav a").evaluateAll(nodes => nodes.map(node => node.textContent?.trim()));
  expect(labels).toEqual(["Visão geral", "Infraestrutura", "VPS", "Serviços", "WhatsApp", "Aplicações"]);
  expect(labels).not.toContain("Recursos");
});

test("public Ver serviços keeps only the VM name and login notice", async ({ page }) => {
  const { hypervisor } = await mockPublicShell(page);
  const vm = hypervisor.vms[0];
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/monitor/infraestrutura");
  await expect(page.getByRole("heading", { name: `VMs de ${hypervisor.name}` })).toBeVisible();
  await page.getByRole("button", { name: `Serviços e containers de ${vm.name}`, exact: true }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("heading", { name: `Serviços e containers de ${vm.name}` })).toBeVisible();
  await expect(dialog.getByText(vm.name, { exact: true })).toBeVisible();
  await expect(dialog.getByText(/só estão disponíveis para usuários logados/)).toBeVisible();
  await expect(dialog.getByRole("link", { name: "Entrar", exact: true })).toBeVisible();
  await expect(dialog.getByText("Última leitura disponível")).toHaveCount(0);
  await expect(dialog.getByText("itens descobertos")).toHaveCount(0);
  await expect(dialog.getByRole("columnheader", { name: "Container / imagem" })).toHaveCount(0);
});

test("public recursos route redirects to login", async ({ page }) => {
  await page.goto("/monitor/recursos");
  await expect(page).toHaveURL(/\/login$/);
});
