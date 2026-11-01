import { test, expect } from "@playwright/test";
import { overview, presentation } from "../fixtures/dashboard";
import { effectiveOptions } from "../../lib/config/presentation";
import { adminFixture } from "../fixtures/admin";
import { signIn } from "../fixtures/infrastructure";

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
  return { hypervisor, document };
}

test("public dashboard starts in TV without changing shared defaults and respects manual exit", async ({ page }) => {
  const state = await mockPublicShell(page);
  const writes: string[] = [];
  page.on("request", request => { if (request.url().includes("/api/") && !["GET", "HEAD"].includes(request.method())) writes.push(request.method() + " " + new URL(request.url()).pathname); });
  await page.goto("/monitor");
  await expect(page.getByRole("button", { name: "Sair do modo TV", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(".dashboard-shell")).toHaveClass(/tv-mode/);
  expect(await page.evaluate(() => document.fullscreenElement === null)).toBe(true);
  expect(state.document.defaultTvMode).toBe(false);
  await page.getByRole("button", { name: "Sair do modo TV", exact: true }).click();
  await expect(page.getByRole("button", { name: "Modo TV", exact: true })).toHaveAttribute("aria-pressed", "false");
  const refreshed = page.waitForResponse(response => new URL(response.url()).pathname === "/api/public/settings/presentation");
  await page.evaluate(() => window.dispatchEvent(new Event("pulse:preferences-changed"))); await refreshed;
  await expect(page.getByRole("button", { name: "Modo TV", exact: true })).toHaveAttribute("aria-pressed", "false");
  await page.getByRole("link", { name: "Serviços", exact: true }).click();
  await expect(page).toHaveURL(/\/monitor\/servicos$/);
  await expect(page.locator(".tv-mode")).toHaveCount(0);
  await page.getByRole("link", { name: "Visão geral", exact: true }).click();
  await expect(page.getByRole("button", { name: "Sair do modo TV", exact: true })).toHaveAttribute("aria-pressed", "true");
  expect(writes).toEqual([]);
});

test("public TV starts before configuration arrives and a late response cannot undo manual exit", async ({ page }) => {
  const state = await mockPublicShell(page);
  let release!: () => void;
  const pending = new Promise<void>(resolve => { release = resolve; });
  await page.route("**/api/public/settings/presentation", async route => { await pending; await route.fulfill({ json: { data: state.document, updatedAt: at } }); });
  await page.goto("/monitor", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("button", { name: "Sair do modo TV", exact: true })).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "Sair do modo TV", exact: true }).click();
  const response = page.waitForResponse(value => new URL(value.url()).pathname === "/api/public/settings/presentation"); release(); await response;
  await expect(page.locator(".dashboard-blocks")).toBeVisible();
  await expect(page.getByRole("button", { name: "Modo TV", exact: true })).toHaveAttribute("aria-pressed", "false");
});

test("public TV remains available during an initial configuration failure and retry", async ({ page }) => {
  const state = await mockPublicShell(page); let fail = true;
  await page.route("**/api/public/settings/presentation", route => route.fulfill(fail ? { status: 503, json: { error: "unavailable" } } : { json: { data: state.document, updatedAt: at } }));
  await page.goto("/monitor");
  await expect(page.getByText("Não foi possível carregar a configuração", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Sair do modo TV", exact: true })).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "Sair do modo TV", exact: true }).click(); fail = false;
  await page.getByRole("button", { name: "Tentar novamente", exact: true }).click();
  await expect(page.locator(".dashboard-blocks")).toBeVisible();
  await expect(page.getByRole("button", { name: "Modo TV", exact: true })).toHaveAttribute("aria-pressed", "false");
});

for (const enabled of [false, true]) test(`authenticated TV default ${enabled} stays independent from public startup`, async ({ page }) => {
  const state = await adminFixture(page); state.document.defaultTvMode = enabled;
  await signIn(page);
  await expect(page.getByRole("button", { name: enabled ? "Sair do modo TV" : "Modo TV", exact: true })).toHaveAttribute("aria-pressed", String(enabled));
  await mockPublicShell(page); await page.goto("/monitor");
  await expect(page.getByRole("button", { name: "Sair do modo TV", exact: true })).toHaveAttribute("aria-pressed", "true");
  await page.goto("/");
  await expect(page.getByRole("button", { name: enabled ? "Sair do modo TV" : "Modo TV", exact: true })).toHaveAttribute("aria-pressed", String(enabled));
  expect(state.writes).toHaveLength(0);
});

test("public services hide container inventory and menu omits Recursos", async ({ page }) => {
  await mockPublicShell(page);
  const scriptWarnings: string[] = [];
  page.on("console", message => { if (message.text().includes("Encountered a script tag")) scriptWarnings.push(message.text()); });
  await page.route("**/monitor-compat-bootstrap.js*", async route => {
    const response = await route.fetch();
    await route.fulfill({ response, body: 'document.documentElement.setAttribute("data-monitor-bootstrap-ran", "true");\n' + await response.text() });
  });
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.goto("/monitor/servicos");
  await expect(page.getByRole("heading", { name: "Softcom Signal" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Inventário de containers" })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Recursos configurados" })).toBeVisible();
  const labels = await page.locator(".monitoring-nav a").evaluateAll(nodes => nodes.map(node => node.textContent?.trim()));
  expect(labels).toEqual(["Visão geral", "Infraestrutura", "VPS", "Serviços", "Aplicações"]);
  expect(labels).not.toContain("Recursos");
  await page.getByRole("link", { name: "Visão geral", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("data-monitor-bootstrap-ran", "true");
  const bootstrap = page.locator('script[src*="/monitor-compat-bootstrap.js"]');
  await expect(bootstrap).toHaveCount(1);
  expect(await bootstrap.evaluate(element => (element as HTMLScriptElement).async)).toBe(true);
  expect(scriptWarnings).toEqual([]);
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
