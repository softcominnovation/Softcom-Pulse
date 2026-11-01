import { test, expect } from "@playwright/test";
import { storageUiFixture } from "../fixtures/storage";
import { signIn } from "../fixtures/infrastructure";
import { id, overview } from "../fixtures/dashboard";
import { effectiveOptions } from "../../lib/config/presentation";
import { publicStorage } from "../../lib/storage/presentation";
import { enterNativeFullscreen, exitNativeFullscreen } from "../fixtures/fullscreen";
import { notificationFixture } from "../fixtures/notifications";

test("Storage Services edits real preferences, keeps drafts on conflict/poll and confirms reset", async ({ page }) => {
  const state = await storageUiFixture(page);
  await signIn(page); await page.goto("/servicos#storages");
  const panel = page.locator("#storages .storage-panel");
  const section = page.getByRole("region", { name: "Storages", exact: true });
  await expect(section).toHaveClass(/dashboard-panel/);
  await expect(section.locator(":scope > .panel-heading")).toContainText("Storages");
  await expect(section.locator(".storage-services-content .storage-panel")).toHaveCount(1);
  await expect(panel).toContainText("Archive One"); await expect(panel).toContainText("Disponível");
  const title = panel.locator(":scope > .panel-heading .service-title");
  const spacing = await title.evaluate(node => {
    const heading = node.querySelector("h2")!.getBoundingClientRect();
    const separator = node.querySelector(".service-title-separator")!.getBoundingClientRect();
    const badge = node.querySelector(".status-pill")!.getBoundingClientRect();
    return { before: separator.left - heading.right, after: badge.left - separator.right, color: getComputedStyle(node.querySelector(".service-title-separator")!).backgroundColor };
  });
  expect(spacing.before).toBeGreaterThan(0);
  expect(spacing.before).toBeCloseTo(spacing.after, 0);
  expect(spacing.color).not.toBe("rgba(0, 0, 0, 0)");
  await panel.getByRole("button", { name: /Configurar Storage/ }).click();
  const dialog = page.getByRole("dialog", { name: "Configuração de Storage" });
  await dialog.getByLabel("Nome do Storage", { exact: true }).fill("My Archive");
  await dialog.getByLabel("Interface de rede", { exact: true }).selectOption(state.items[0].interfaces[0].key);
  await page.evaluate(() => window.dispatchEvent(new Event("pulse:preferences-changed")));
  await expect(dialog.getByLabel("Nome do Storage", { exact: true })).toHaveValue("My Archive");
  await dialog.getByLabel("Selecionar volumes manualmente", { exact: true }).check();
  await dialog.getByLabel("/", { exact: true }).check(); await dialog.getByLabel("/data/volume-1", { exact: true }).check();
  await dialog.getByRole("button", { name: "Salvar Storage", exact: true }).click();
  await expect(dialog.getByRole("alert")).toContainText("independência"); expect(state.writes).toHaveLength(0);
  await dialog.getByLabel("Confirmo que os volumes selecionados", { exact: false }).check();
  state.conflict = true;
  await dialog.getByRole("button", { name: "Salvar Storage", exact: true }).click();
  await expect(dialog.getByText("Esta configuração foi alterada", { exact: false })).toBeVisible();
  await expect(dialog.getByLabel("Nome do Storage", { exact: true })).toHaveValue("My Archive");
  state.conflict = false;
  await dialog.getByRole("button", { name: "Salvar Storage", exact: true }).click();
  await expect(dialog).toHaveCount(0); expect(state.writes[0].filesystemKeys).toHaveLength(2);
  expect(state.writes[0].networkInterfaceKey).toBe(state.items[0].interfaces[0].key);
  await expect(panel).toContainText("My Archive");
  await panel.getByRole("button", { name: /Configurar Storage/ }).click();
  await dialog.getByRole("button", { name: "Restaurar padrões", exact: true }).click();
  await page.getByRole("dialog", { name: "Restaurar padrões de Storage?" }).getByRole("button", { name: "Cancelar" }).click();
  await expect(dialog.getByLabel("Nome do Storage", { exact: true })).toHaveValue("My Archive");
  await dialog.getByRole("button", { name: "Cancelar", exact: true }).click();
});

for (const width of [390, 1366]) test(`Storage disk warning uses the card volumes, retains conflicting drafts and can be disabled at ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: 900 });
  const state = await storageUiFixture(page), notifications = await notificationFixture(page);
  const original = structuredClone(state.configs[0]);
  notifications.targets.push({ ref: `storage:${original.id}`, label: original.displayName!, critical: true, enabled: true });
  await signIn(page); await page.goto("/servicos#storages");
  const trigger = page.locator("#storages").getByRole("button", { name: "Notificações deste serviço", exact: true });
  await trigger.click();
  const dialog = page.getByRole("dialog", { name: "Notificações do serviço", exact: true });
  const enabled = dialog.getByLabel("Alertar ocupação do disco", { exact: true }), limit = dialog.getByLabel("Limite de disco (%)", { exact: true });
  await expect(enabled).not.toBeChecked(); await expect(limit).toBeDisabled();
  await enabled.check(); await expect(limit).toHaveValue("70");
  await expect(dialog.getByText("Volumes monitorados: /. A seleção é feita em Editar configuração.", { exact: true })).toBeVisible();
  await limit.fill("101"); await dialog.getByRole("button", { name: "Salvar alerta de disco", exact: true }).click(); expect(state.writes).toHaveLength(0);
  await limit.fill("75"); state.conflict = true;
  await dialog.getByRole("tab", { name: "Entrega e sons", exact: true }).click();
  await dialog.getByLabel("Som deste serviço", { exact: true }).selectOption("off");
  await dialog.getByRole("tab", { name: "Alerta de disco", exact: true }).click();
  await dialog.getByRole("button", { name: "Salvar alerta de disco", exact: true }).click();
  await expect(dialog.getByText("Esta configuração foi alterada", { exact: false })).toBeVisible(); await expect(limit).toHaveValue("75");
  await page.keyboard.press("Escape"); await expect(trigger).toBeFocused(); await trigger.click(); await expect(limit).toHaveValue("75");
  state.conflict = false; await dialog.getByRole("button", { name: "Salvar alerta de disco", exact: true }).click(); await expect.poll(() => state.writes.length).toBe(1);
  await expect(dialog.getByRole("button", { name: "Salvar alerta de disco", exact: true })).toBeEnabled();
  expect(state.writes[0].diskWarningPercent).toBe(75); expect(state.writes[0].filesystemKeys).toEqual([state.items[0].volumes[0].key]);
  for (const key of ["displayName", "description", "critical", "dashboardEnabled", "displayOrder", "networkInterfaceKey"] as const) expect(state.writes[0][key]).toEqual(original[key]);
  await dialog.getByRole("tab", { name: "Entrega e sons", exact: true }).click();
  await expect(dialog.getByLabel("Som deste serviço", { exact: true })).toHaveValue("off"); expect(notifications.writes).toBe(0);
  await dialog.getByRole("tab", { name: "Alerta de disco", exact: true }).click();
  await expect(limit).toBeEnabled(); await expect(limit).toHaveValue("75");
  await dialog.screenshot({ path: `.cache/storage-validation/notifications-disk-${width}.png` });
  await page.keyboard.press("Escape"); await trigger.click(); await expect(limit).toHaveValue("75");
  await enabled.uncheck(); await dialog.getByRole("button", { name: "Salvar alerta de disco", exact: true }).click(); await expect.poll(() => state.writes.length).toBe(2);
  await expect(dialog.getByRole("button", { name: "Salvar alerta de disco", exact: true })).toBeEnabled();
  expect(state.writes.at(-1)!.diskWarningPercent).toBeNull();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

for (const width of [390, 1366]) test(`Storage separates configuration and notification dialogs without changing saved preferences at ${width}px`, async ({ page }) => {
  const height = width > 700 ? 768 : 844;
  await page.setViewportSize({ width, height });
  const state = await storageUiFixture(page), notifications = await notificationFixture(page);
  const ref = `storage:${state.configs[0].id}`;
  notifications.targets.push({ ref, label: state.items[0].displayName, critical: true, enabled: true });
  await signIn(page); await page.goto("/servicos#storages");
  const panel = page.locator("#storages .storage-panel"), trigger = panel.getByRole("button", { name: "Notificações deste serviço", exact: true });
  await panel.getByRole("button", { name: /Configurar Storage/ }).click();
  const config = page.getByRole("dialog", { name: "Configuração de Storage", exact: true });
  await expect(config.getByRole("button", { name: "Notificações deste serviço", exact: true })).toHaveCount(0);
  await expect(config.getByLabel("Limite de disco (%)", { exact: true })).toHaveCount(0);
  await expect(config.getByLabel("Alertar ocupação do disco", { exact: true })).toHaveCount(0);
  await config.getByRole("button", { name: "Cancelar", exact: true }).click();
  const before = (await panel.boundingBox())!;
  await trigger.click();
  const dialog = page.getByRole("dialog", { name: "Notificações do serviço", exact: true });
  await expect(config).toHaveCount(0); await expect(dialog).toContainText(state.items[0].displayName);
  await dialog.getByLabel("Alertar ocupação do disco", { exact: true }).check();
  await dialog.getByLabel("Limite de disco (%)", { exact: true }).fill("83");
  const size = (await dialog.boundingBox())!; expect(size.width).toBeLessThanOrEqual(width - 30); expect(size.height).toBeLessThanOrEqual(height - 30);
  await dialog.getByRole("tab", { name: "Entrega e sons", exact: true }).click();
  await dialog.getByLabel("Som deste serviço", { exact: true }).selectOption("off");
  await page.keyboard.press("Escape"); await expect(trigger).toBeFocused(); await trigger.click();
  await expect(dialog.getByLabel("Som deste serviço", { exact: true })).toHaveValue("off");
  await dialog.getByRole("tab", { name: "Alerta de disco", exact: true }).click();
  await expect(dialog.getByLabel("Limite de disco (%)", { exact: true })).toHaveValue("83");
  await dialog.getByRole("tab", { name: "Entrega e sons", exact: true }).click();
  await dialog.getByRole("button", { name: "Salvar notificações deste serviço", exact: true }).click();
  await expect.poll(() => notifications.policy.overrides[ref]?.sound).toBe("off");
  await dialog.getByRole("tab", { name: "Alerta de disco", exact: true }).click();
  await expect(dialog.getByLabel("Limite de disco (%)", { exact: true })).toHaveValue("83");
  await dialog.getByRole("button", { name: "Fechar diálogo", exact: true }).click();
  await expect(trigger).toBeFocused(); expect(state.writes).toHaveLength(0);
  expect((await panel.boundingBox())!.height).toBeCloseTo(before.height, 0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test("Storage configuration saves and restores presentation defaults without changing its active disk alert", async ({ page }) => {
  const state = await storageUiFixture(page);
  Object.assign(state.configs[0], { diskWarningPercent: 75, filesystemKeys: [state.items[0].volumes[0].key] });
  await signIn(page); await page.goto("/servicos#storages");
  await page.getByRole("button", { name: /Configurar Storage/ }).click();
  const dialog = page.getByRole("dialog", { name: "Configuração de Storage", exact: true });
  await expect(dialog.getByLabel("Limite de disco (%)", { exact: true })).toHaveCount(0);
  await expect(dialog.getByLabel("Selecionar volumes manualmente", { exact: true })).toBeDisabled();
  await dialog.getByRole("button", { name: "Restaurar padrões", exact: true }).click();
  await page.getByRole("dialog", { name: "Restaurar padrões de Storage?", exact: true }).getByRole("button", { name: "Restaurar padrões", exact: true }).click();
  await expect(dialog.getByLabel("/", { exact: true })).toBeChecked();
  await dialog.getByRole("button", { name: "Salvar Storage", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  expect(state.writes[0].diskWarningPercent).toBe(75);
  expect(state.writes[0].filesystemKeys).toEqual([state.items[0].volumes[0].key]);
  expect(state.writes[0].critical).toBe(true);
});

test("Storage notifications reload a changed configuration before enabling a disk alert and allow disabling on stale inventory", async ({ page }) => {
  const state = await storageUiFixture(page), notifications = await notificationFixture(page);
  notifications.targets.push({ ref: `storage:${state.configs[0].id}`, label: state.items[0].displayName, critical: true, enabled: true });
  await signIn(page); await page.goto("/servicos#storages");
  const trigger = page.locator("#storages").getByRole("button", { name: "Notificações deste serviço", exact: true });
  const dialog = page.getByRole("dialog", { name: "Notificações do serviço", exact: true });
  await trigger.click(); await expect(dialog.getByLabel("Limite de disco (%)", { exact: true })).toBeDisabled();
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: /Configurar Storage/ }).click();
  const config = page.getByRole("dialog", { name: "Configuração de Storage", exact: true });
  await config.getByLabel("Nome do Storage", { exact: true }).fill("Archive Renamed");
  await config.getByRole("button", { name: "Salvar Storage", exact: true }).click(); await expect(config).toHaveCount(0);
  await trigger.click(); await expect(dialog).toContainText("Archive Renamed");
  const enabled = dialog.getByLabel("Alertar ocupação do disco", { exact: true });
  const save = dialog.getByRole("button", { name: "Salvar alerta de disco", exact: true });
  let releaseWrite = () => {};
  state.writeResponseBarrier = new Promise<void>(resolve => { releaseWrite = resolve; });
  try {
    await enabled.check(); await save.click();
    await expect.poll(() => state.writes.length).toBe(2); expect(state.writes[1].displayName).toBe("Archive Renamed");
    await expect(dialog.getByRole("button", { name: "Salvando…", exact: true })).toBeDisabled();
    await page.keyboard.press("Escape"); await expect(dialog).toBeVisible();
  } finally { releaseWrite(); state.writeResponseBarrier = null; }
  await expect(save).toBeEnabled();
  await page.keyboard.press("Escape"); await expect(dialog).toBeHidden(); await expect(trigger).toBeFocused();
  state.items[0].stale = true;
  await page.evaluate(() => window.dispatchEvent(new Event("pulse:preferences-changed")));
  await trigger.click(); await expect(dialog.getByText("Descoberta indisponível ou antiga.", { exact: false })).toBeVisible();
  await expect(enabled).toBeEnabled(); await enabled.uncheck();
  await dialog.getByRole("button", { name: "Salvar alerta de disco", exact: true }).click();
  await expect.poll(() => state.writes.length).toBe(3); expect(state.writes[2].diskWarningPercent).toBeNull();
  await expect(save).toBeEnabled();
  await expect(enabled).toBeDisabled(); expect(notifications.writes).toBe(0);
});

test("Storage minicard preserves dimensions and loads details only when opened, with focus return", async ({ page }) => {
  const state = await storageUiFixture(page); await signIn(page);
  const card = page.getByRole("button", { name: "Detalhes de Archive One: Disponível", exact: true });
  await expect(card).toBeVisible(); expect(state.detailCalls).toBe(0); expect(state.listCalls).toBe(0);
  const box = await card.boundingBox(); expect(box!.height).toBe(120); expect(box!.width).toBeLessThanOrEqual(230);
  await expect(card.locator(".availability-reading")).toHaveCount(2);
  await expect(card.locator(".availability-reading").nth(1)).toContainText("Disco");
  await expect(card.locator(".availability-reading").nth(1)).toContainText("40%");
  await expect(card.locator(".storage-mini-traffic").nth(0)).toHaveText("RX —");
  await expect(card.locator(".storage-mini-traffic").nth(1)).toHaveText("TX —");
  state.items[0].selectedInterface = state.items[0].interfaces[0];
  await page.evaluate(() => window.dispatchEvent(new Event("pulse:preferences-changed")));
  await expect(card.locator(".storage-mini-traffic").nth(0)).toHaveText("RX 1 kbit/s");
  await expect(card.locator(".storage-mini-traffic").nth(1)).toHaveText("TX 0 bit/s");
  await card.screenshot({ path: ".cache/storage-validation/minicard-traffic.png" });
  await card.focus(); await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog", { name: "Archive One", exact: true });
  await expect(dialog.locator(".storage-panel")).toContainText("Disco ocupado");
  await expect.poll(() => state.detailCalls).toBe(1);
  await expect(dialog.getByRole("link", { name: "Ver em Serviços" })).toHaveAttribute("href", /storage=storage-/);
  await page.keyboard.press("Escape"); await expect(card).toBeFocused();
});

test("Storage keeps TV and scale when native fullscreen has already closed before cleanup", async ({ page }) => {
  const state = await storageUiFixture(page);
  state.admin.document.displayScalePercent = 125;
  state.admin.document.screens[0].blocks.push({ id: id(9092), type: "storage_summary", width: "wide", enabled: true, options: { storageConfigId: state.configs[0].id, visibleRows: 3 } });
  await page.setViewportSize({ width: 3440, height: 1440 }); await signIn(page);
  await page.getByRole("button", { name: "Modo TV", exact: true }).click();
  await enterNativeFullscreen(page);
  await exitNativeFullscreen(page);
  await exitNativeFullscreen(page);
  await expect(page.locator(".dashboard-shell")).toHaveAttribute("data-display-scale", "125");
  await expect(page.getByRole("button", { name: "Sair do modo TV", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(".storage-panel")).toContainText("Archive One");
  await page.getByRole("button", { name: "Sair do modo TV", exact: true }).click();
  await expect(page.locator(".dashboard-shell")).toHaveAttribute("data-display-scale", "100");
});

for (const viewport of [{ width: 1366, height: 768 }, { width: 1920, height: 1080 }, { width: 3440, height: 1440 }]) for (const layout of ["default", "split", "wall"] as const) {
  test(`Storage composition ${layout} ${viewport.width} preserves panels/footer across scales and modes`, async ({ page }) => {
    const state = await storageUiFixture(page), screen = state.admin.document.screens[0];
    screen.layout = layout === "wall" ? "wall" : "overview"; screen.overviewGrid = layout === "split" ? "split" : "default";
    // Four existing panels plus Storage; duplicate Storage tested below with the dense fallback.
    screen.blocks.push({ id: id(9091), type: "signal_flow", width: "wide", enabled: true, options: effectiveOptions({ type: "signal_flow" }) }, { id: id(9092), type: "storage_summary", width: "wide", enabled: true, options: { storageConfigId: state.configs[0].id, visibleRows: 3 } });
    await page.setViewportSize(viewport); await signIn(page);
    await expect(page.locator("[data-storage-layout]")).toBeVisible();
    for (const scale of [100, 110, 120, 125]) {
      state.admin.document.displayScalePercent = scale as 100 | 110 | 120 | 125;
      state.admin.document.revision++;
      await page.evaluate(() => window.dispatchEvent(new Event("pulse:preferences-changed")));
      for (const mode of ["normal", "tv", "fullscreen"]) {
        if (mode === "tv") await page.getByRole("button", { name: "Modo TV", exact: true }).click();
        if (mode === "fullscreen") await enterNativeFullscreen(page);
        await expect(page.locator(".dashboard-shell")).toHaveAttribute("data-display-scale", String(mode === "normal" ? 100 : scale));
        await expect(page.locator("[data-storage-layout]")).toBeVisible();
        const geometry = await page.locator(".storage-composition").evaluate(root => {
          const boxes = [...root.querySelectorAll(".storage-composition-cell")].map(node => node.getBoundingClientRect());
          return { overlap: boxes.some((a, i) => boxes.some((b, j) => i < j && Math.min(a.right, b.right) - Math.max(a.left, b.left) > 2 && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 2)), viewportOverflow: document.documentElement.scrollWidth > innerWidth + 1, footerBottom: document.querySelector(".dashboard-footer")!.getBoundingClientRect().bottom, bodyHeight: root.querySelector(".storage-body")!.clientHeight };
        });
        expect(geometry.overlap).toBe(false); expect(geometry.viewportOverflow).toBe(false); expect(geometry.bodyHeight).toBeGreaterThan(30);
        expect(geometry.footerBottom).toBeLessThanOrEqual(viewport.height + 2);
        if (layout === "split") {
          const pair = page.locator(".storage-composition-pair .dashboard-panel");
          expect((await pair.nth(0).boundingBox())!.height).toBeCloseTo((await pair.nth(1).boundingBox())!.height, 0);
        }
        if (mode === "fullscreen") { await exitNativeFullscreen(page); await page.getByRole("button", { name: "Sair do modo TV", exact: true }).click(); }
      }
    }
    await page.screenshot({ path: `.cache/storage-validation/storage-${layout}-${viewport.width}.png`, fullPage: true });
  });
}

test("Storage admin catalog, duplicate block, preview and persisted UUID use the configured storage", async ({ page }) => {
  const state = await storageUiFixture(page); await page.setViewportSize({ width: 1366, height: 768 }); await signIn(page); await page.goto("/admin/configuracoes");
  await page.getByLabel("Novo bloco").selectOption("storage_summary");
  await page.getByRole("button", { name: "Adicionar bloco", exact: true }).click();
  const blocks = page.getByRole("article", { name: "Storage · capacidade e recursos na tela 1" });
  await expect(blocks).toHaveCount(1); await expect(blocks.getByLabel("Storage do painel")).toHaveValue(state.configs[0].id);
  await blocks.getByRole("button", { name: "Duplicar Storage · capacidade e recursos", exact: true }).click();
  await expect(blocks).toHaveCount(2);
  await page.getByRole("button", { name: "Ver prévia", exact: true }).click();
  await expect(page.locator(".dashboard-preview .storage-panel")).toHaveCount(2);
  await expect(page.getByText("Esta composição precisa de rolagem nesta altura de tela.", { exact: false })).toBeVisible();
  expect(state.admin.writes).toHaveLength(0);
  await page.getByRole("button", { name: "Salvar apresentação", exact: true }).click();
  await expect.poll(() => state.admin.document.revision).toBe(2);
  const saved = state.admin.document.screens[0].blocks.filter(block => block.type === "storage_summary");
  expect(saved[0].id).not.toBe(saved[1].id); expect(saved[0].options!.storageConfigId).toBe(saved[1].options!.storageConfigId);
});

test("dense duplicate Storage blocks scroll inside the composition and keep every panel reachable", async ({ page }) => {
  const state = await storageUiFixture(page), screen = state.admin.document.screens[0];
  screen.blocks = Array.from({ length: 6 }, (_, index) => ({ id: id(9200 + index), type: "storage_summary", width: "full", enabled: true, options: { storageConfigId: state.configs[0].id, visibleRows: 10 } }));
  await page.setViewportSize({ width: 1366, height: 768 }); await signIn(page);
  const composition = page.locator("[data-storage-layout]"); await expect(composition).toHaveAttribute("data-overflow", "true");
  await expect(composition.locator(".storage-panel")).toHaveCount(6);
  expect(await composition.evaluate(node => node.scrollHeight > node.clientHeight)).toBe(true);
  await composition.locator(".storage-panel").last().scrollIntoViewIfNeeded();
  await expect(composition.locator(".storage-panel").last().getByRole("heading", { name: "Archive One" })).toBeInViewport();
  expect((await page.locator(".dashboard-footer").boundingBox())!.y).toBeLessThan(768);
});

for (const width of [320, 390, 768, 1024]) test(`Storage Services ${width}px supports light/dark, keyboard and reduced motion`, async ({ page }) => {
  await storageUiFixture(page); await page.setViewportSize({ width, height: 900 }); await page.emulateMedia({ reducedMotion: "reduce" }); await signIn(page); await page.goto("/servicos#storages");
  const panel = page.locator("#storages .storage-panel"); await expect(panel).toBeVisible();
  for (const theme of ["dark", "light"]) {
    await page.evaluate(value => { document.documentElement.dataset.theme = value; document.documentElement.classList.toggle("dark", value === "dark"); }, theme);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    await panel.getByRole("button", { name: /Configurar Storage/ }).focus(); await page.keyboard.press("Enter");
    const dialog = page.getByRole("dialog", { name: "Configuração de Storage" }); await expect(dialog).toBeVisible(); await expect(dialog.getByLabel("Nome do Storage", { exact: true })).toBeVisible(); await page.keyboard.press("Escape");
  }
});

test("public Storage modal and Services use public routes, generic volumes and no editor controls", async ({ page }) => {
  const state = await storageUiFixture(page);
  state.items[0].selectedInterface = state.items[0].interfaces[0];
  const item = publicStorage(state.items[0]), at = item.evidence.observedAt;
  const env = <T>(data: T) => ({ data, availability: "ready", stale: false, lastUpdated: at, refreshAfterMs: 20000 });
  await page.route("**/api/public/settings/presentation", route => route.fulfill({ json: { data: state.admin.document, updatedAt: at } }));
  await page.route("**/api/public/dashboard/overview*", route => {
    const body = overview(state.admin.document);
    body.data.blocks.find(block => block.type === "highlighted_resources")!.data = { cards: [{ kind: "storage", item }] };
    return route.fulfill({ json: body });
  });
  await page.route("**/api/public/monitoring/storages", route => route.fulfill({ json: env({ items: [item], orphans: [], status: "ok", error: null }) }));
  await page.route("**/api/public/monitoring/storages/*", route => route.fulfill({ json: env(item) }));
  await page.route("**/api/public/monitoring/signal-targets", route => route.fulfill({ json: { data: [] } }));
  await page.route("**/api/public/monitoring/services", route => route.fulfill({ json: env([]) }));
  await page.route("**/api/public/monitoring/problems", route => route.fulfill({ json: env([]) }));
  const privateCalls: string[] = [];
  page.on("request", request => { if (/\/api\/(settings\/storages|monitoring\/storages)/.test(request.url())) privateCalls.push(request.url()); });
  await page.goto("/monitor");
  const card = page.getByRole("button", { name: "Detalhes de Archive One: Disponível" });
  await expect(card.locator(".storage-mini-traffic").first()).toHaveText("RX 1 kbit/s");
  await expect(card.locator(".storage-mini-traffic").last()).toHaveText("TX 0 bit/s");
  await card.click();
  const modal = page.getByRole("dialog", { name: "Archive One", exact: true });
  await expect(modal).toContainText("Volume 1"); await expect(modal).not.toContainText("/data");
  const link = modal.getByRole("link", { name: "Ver em Serviços" }); await expect(link).toHaveAttribute("href", /\/monitor\/servicos\?storage=/);
  await link.click(); await expect(page).toHaveURL(/\/monitor\/servicos\?storage=.*#storages/);
  await expect(page.locator("#storages .storage-panel")).toContainText("Volume 1");
  await expect(page.locator("#storages").getByRole("button", { name: /Configurar Storage/ })).toHaveCount(0);
  expect(privateCalls).toHaveLength(0);
});
