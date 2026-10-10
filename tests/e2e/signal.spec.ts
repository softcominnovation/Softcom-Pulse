import { test, expect } from "@playwright/test";
import { adminFixture } from "../fixtures/admin";
import { servicesFixture } from "../fixtures/services";
import { signIn } from "../fixtures/infrastructure";
import { id, overview, presentation } from "../fixtures/dashboard";
import { effectiveOptions } from "../../lib/config/presentation";

const checkedAt = new Date().toISOString();
const strip = Array.from({ length: 40 }, () => 0);
const signalTarget = {
  id: id(910), displayName: "Softcom Signal", description: "API", baseUrl: "https://api-signal.example",
  enabled: true, dashboardEnabled: true, critical: true, displayOrder: 0, timeoutMs: 5000, revision: 1,
  state: 0, latencyMs: 42, httpStatus: 200, liveOk: true, readyStatus: "ok", workerStatus: "up",
  activeInstances: 2, outboxPending: 0, inboxPending: 0, outboxDead: 0, inboxDead: 142,
  oldestOutboxSeconds: 0, oldestInboxSeconds: 0,
  checks: {
    database: "up", redis: { status: "up" }, objectStorage: { status: "up" }, workdeskAudio: { status: "up" },
    worker: { status: "up", activeInstances: 2, lastHeartbeatAt: checkedAt, ageSeconds: 1 },
    knowledgeIndex: { itemsPending: 3, itemsFailed: 0, jobsQueued: 5, jobsRunning: 2, jobsFailedCurrent: 0, expiredLeases: 0, itemsWithoutActiveJob: 0 },
  },
  strip, uptime24h: { available: 40, total: 40 }, uptime7d: { available: 100, total: 100 }, uptime30d: { available: 200, total: 200 },
  checkedAt, links: [{
    id: id(911), role: "manager", label: "Signal Manager", hostKey: "vm-signal-manager",
    vmKey: "vm-aaa", parentHostKey: "ASGARD", inventoryStatus: "ready",
    inventoryName: "vm-signal-manager", inventoryAvailability: "running",
    cpuUsagePercent: 2.8, memoryUsagePercent: 42.9,
  }], createdAt: checkedAt, updatedAt: checkedAt,
};

test("signal panel on services shows metrics and keeps DLQ from forcing attention badge", async ({ page }) => {
  await servicesFixture(page);
  await page.route("**/api/monitoring/signal-targets", route => route.fulfill({ json: { data: [signalTarget] } }));
  await signIn(page);
  await page.goto("/servicos#signal");
  await expect(page.locator("#signal")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Softcom Signal" })).toBeVisible();
  await expect(page.locator("#signal .app-presence")).toHaveText("Disponível");
  await expect(page.getByText("Filas de processamento")).toBeVisible();
  await expect(page.getByText("Dead letter").first()).toBeVisible();
  await expect(page.getByText("142").first()).toBeVisible();
  await expect(page.getByRole("heading", { name: "VMs vinculadas" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Vincular VM" })).toBeVisible();
  await expect(page.getByRole("article", { name: "Signal Manager: Disponível" })).toBeVisible();
  await expect(page.locator("#signal .availability-description")).toHaveText("Manager");
  await expect(page.locator("#signal .availability-card").getByText("2,8%")).toBeVisible();
  await expect(page.getByText("1.284")).toHaveCount(0);
});

test("dashboard signal card and flow stay honest about jobs", async ({ page }) => {
  const state = await adminFixture(page);
  const signalCard = {
    id: signalTarget.id, displayName: signalTarget.displayName, description: signalTarget.description,
    critical: true, displayOrder: 0, enabled: true, state: 0, latencyMs: 42, readyStatus: "ok",
    workerStatus: "up", activeInstances: 2, strip, uptime24h: signalTarget.uptime24h, checkedAt,
  };
  const flow = {
    target: {
      id: signalTarget.id, displayName: signalTarget.displayName, description: signalTarget.description,
      state: 0, latencyMs: 42, readyStatus: "ok", workerStatus: "up", activeInstances: 2, strip, checkedAt,
      outboxPending: 0, inboxPending: 0, outboxDead: 0, inboxDead: 142, oldestOutboxSeconds: 0, oldestInboxSeconds: 0,
      checks: signalTarget.checks,
    },
  };
  const problems = state.document.screens[0].blocks.find(block => block.type === "problems")!;
  problems.type = "signal_flow";
  problems.width = "wide";
  problems.options = effectiveOptions({ type: "signal_flow" });
  await page.route("**/api/dashboard/overview*", route => {
    const payload = overview(state.document, new URL(route.request().url()).searchParams.get("screenId") ?? undefined);
    payload.data.signalCards = [signalCard];
    payload.data.blocks = payload.data.blocks.map(block => block.type === "signal_flow" ? { ...block, data: flow } : block);
    return route.fulfill({ json: payload });
  });
  await page.route("**/api/monitoring/signal-targets", route => route.fulfill({ json: { data: [signalTarget] } }));
  await page.setViewportSize({ width: 1366, height: 768 });
  await signIn(page);
  await page.goto("/");
  await expect(page.locator(".signal-card-highlight")).toBeVisible();
  await expect(page.getByRole("link", { name: /Ver métricas/i })).toBeVisible();
  await expect(page.getByLabel("Jobs do índice de conhecimento")).toBeVisible();
  await expect(page.locator("#signal-flow").getByText("Em fila")).toBeVisible();
  await expect(page.locator("#signal-flow").getByText("5", { exact: true })).toBeVisible();
  await expect(page.locator("#signal-flow").getByText("Rodando")).toBeVisible();
  await expect(page.locator("#signal-flow").getByText("Pendentes")).toBeVisible();
  await expect(page.getByLabel("Filas do pipeline")).toBeVisible();
  await expect(page.getByLabel("Filas do pipeline").getByText("Dead letter", { exact: true })).toBeVisible();
  await expect(page.getByText("1.284")).toHaveCount(0);
  await expect(page.getByText("Sem série de volume")).toHaveCount(0);
});

test("admin signal redirects to services", async ({ page }) => {
  await adminFixture(page);
  await page.route("**/api/monitoring/signal-targets", route => route.fulfill({ json: { data: [] } }));
  await signIn(page);
  await page.goto("/admin/signal");
  await expect(page).toHaveURL(/\/servicos#signal$/);
});

test("public monitor shows Signal flow and read-only services metrics", async ({ page }) => {
  const document = presentation(1, 1);
  document.schemaVersion = 2;
  for (const block of document.screens[0].blocks) block.options = effectiveOptions({ type: block.type });
  const problems = document.screens[0].blocks.find(block => block.type === "problems")!;
  problems.type = "signal_flow";
  problems.width = "wide";
  problems.options = effectiveOptions({ type: "signal_flow" });
  const signalCard = {
    id: signalTarget.id, displayName: signalTarget.displayName, description: signalTarget.description,
    critical: true, displayOrder: 0, enabled: true, state: 0, latencyMs: 42, readyStatus: "ok",
    workerStatus: "up", activeInstances: 2, strip, uptime24h: signalTarget.uptime24h, checkedAt,
  };
  const flow = {
    target: {
      id: signalTarget.id, displayName: signalTarget.displayName, description: signalTarget.description,
      state: 0, latencyMs: 42, readyStatus: "ok", workerStatus: "up", activeInstances: 2, strip, checkedAt,
      outboxPending: 0, inboxPending: 0, outboxDead: 0, inboxDead: 142, oldestOutboxSeconds: 0, oldestInboxSeconds: 0,
      checks: signalTarget.checks,
    },
  };
  await page.route("**/api/public/settings/presentation", route => route.fulfill({ json: { data: document, updatedAt: checkedAt } }));
  await page.route("**/api/public/dashboard/overview*", route => {
    const payload = overview(document, new URL(route.request().url()).searchParams.get("screenId") ?? undefined);
    payload.data.signalCards = [signalCard];
    payload.data.summary.jobsWaiting = 0;
    payload.data.blocks = payload.data.blocks.map(block => block.type === "signal_flow" ? { ...block, data: flow, availability: "ready" } : block);
    return route.fulfill({ json: payload });
  });
  await page.route("**/api/public/monitoring/signal-targets", route => route.fulfill({ json: { data: [signalTarget] } }));
  await page.route("**/api/public/monitoring/hosts", route => route.fulfill({ json: { data: [], availability: "ready", stale: false, lastUpdated: checkedAt, refreshAfterMs: 20000 } }));
  await page.route("**/api/public/monitoring/containers", route => route.fulfill({ json: { data: [], availability: "ready", stale: false, lastUpdated: checkedAt, refreshAfterMs: 20000 } }));
  await page.route("**/api/public/monitoring/services", route => route.fulfill({ json: { data: [], availability: "ready", stale: false, lastUpdated: checkedAt, refreshAfterMs: 20000 } }));
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.goto("/monitor");
  await expect(page.locator("#signal-flow")).toBeVisible();
  await expect(page.getByText("Este bloco não está disponível nesta superfície.", { exact: true })).toHaveCount(0);
  await expect(page.locator(".signal-card-highlight")).toBeVisible();
  await expect(page.getByRole("link", { name: /Ver métricas/i })).toHaveAttribute("href", "/monitor/servicos#signal");
  await page.goto("/monitor/servicos#signal");
  await expect(page.locator("#signal")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Softcom Signal" })).toBeVisible();
  await expect(page.getByText(/Disponibilidade · 24h/)).toBeVisible();
  await expect(page.getByText("Filas de processamento")).toBeVisible();
  await expect(page.getByRole("button", { name: "Vincular VM" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Cadastrar Signal" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Editar" })).toHaveCount(0);
});
