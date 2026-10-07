import { test, expect, type Page } from "@playwright/test";
import { adminFixture } from "../fixtures/admin";
import { signIn } from "../fixtures/infrastructure";

const helpLabel = "Como autorizar tela cheia automática";
const settingsUrl = "chrome://policy";
const commandLabel = "Comando de configuração do Chrome no Windows";

test("help reflects the native Chromium permission without granting it", async ({ page }) => {
  const state = await adminFixture(page); await signIn(page); await page.goto("/admin/configuracoes");
  const permission = await page.evaluate(async () => {
    try { return (await navigator.permissions.query({ name: "fullscreen" as PermissionName, allowWithoutGesture: true } as PermissionDescriptor)).state; }
    catch { return "unknown"; }
  });
  await page.getByRole("button", { name: helpLabel }).click();
  const expected = permission === "granted" ? "Tela cheia automática autorizada neste navegador." : permission === "unknown" ? "Este navegador não permite consultar a autorização automática." : "Tela cheia automática ainda não autorizada neste navegador.";
  await expect(page.getByRole("dialog").getByText(expected, { exact: true })).toBeVisible();
  expect(await page.evaluate(() => !!document.fullscreenElement)).toBe(false);
  expect(state.writes).toHaveLength(0);
});

async function setup(page: Page) {
  await page.addInitScript(() => {
    const permission = Object.assign(new EventTarget(), { state: "denied" });
    let queryFails = false, copyFails = false;
    const original = navigator.permissions.query.bind(navigator.permissions);
    navigator.permissions.query = async descriptor => {
      if (descriptor.name !== "fullscreen" as PermissionName) return original(descriptor);
      document.documentElement.dataset.permissionDescriptor = JSON.stringify(descriptor);
      if (queryFails) throw new TypeError("unsupported permission");
      return permission as PermissionStatus;
    };
    window.addEventListener("test-permission", event => {
      const change = (event as CustomEvent).detail;
      permission.state = change.state ?? permission.state;
      queryFails = change.queryFails ?? queryFails;
      if (change.notify) permission.dispatchEvent(new Event("change"));
    });
    window.addEventListener("test-copy-fails", () => { copyFails = true; });
    Object.defineProperty(navigator, "clipboard", { value: { writeText: async (value: string) => {
      if (copyFails) throw new Error("clipboard blocked");
      document.documentElement.dataset.copied = value;
    } } });
    document.documentElement.requestFullscreen = async () => { document.documentElement.dataset.fullscreenRequested = "true"; };
  });
  const state = await adminFixture(page);
  await signIn(page); await page.goto("/admin/configuracoes");
  return state;
}

test("fullscreen help checks the current origin and copies all three Pulse origins without saving or requesting fullscreen", async ({ page }) => {
  const state = await setup(page);
  await page.getByLabel("Nome da tela", { exact: true }).fill("Rascunho preservado");
  await page.getByRole("button", { name: helpLabel }).click();
  const dialog = page.getByRole("dialog", { name: "Tela cheia automática no Chrome" });
  await expect(dialog.getByText("Tela cheia automática ainda não autorizada neste navegador.", { exact: true })).toBeVisible();
  await expect(dialog.getByLabel("Endereço do Pulse neste ambiente", { exact: true })).toHaveValue(new URL(page.url()).origin);
  await expect(dialog.getByLabel("Página para verificar as políticas do Chrome", { exact: true })).toHaveValue(settingsUrl);
  expect(await page.locator("html").getAttribute("data-permission-descriptor")).toBe(JSON.stringify({ name: "fullscreen", allowWithoutGesture: true }));
  await dialog.getByRole("button", { name: "Copiar página para verificar as políticas do chrome" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-copied", settingsUrl);
  await dialog.getByRole("button", { name: "Copiar endereço do pulse neste ambiente" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-copied", new URL(page.url()).origin);
  await dialog.getByRole("button", { name: `Copiar ${commandLabel.toLocaleLowerCase("pt-BR")}` }).click();
  const instructions = await page.locator("html").getAttribute("data-copied");
  for (const origin of ["http://localhost:3000", "https://dev-pulse.softcomtecnologia.com", "https://pulse.softcomtecnologia.com"]) {
    expect(instructions).toContain(`'${origin}'`);
  }
  expect(instructions).not.toContain(new URL(page.url()).origin);
  await expect(dialog.getByLabel(commandLabel, { exact: true })).toHaveValue(instructions!);
  expect(instructions).toContain("AutomaticFullscreenAllowedForUrls"); expect(instructions).not.toContain("*");
  expect(instructions).not.toContain("HKLM"); expect(instructions).not.toContain("Remove-");
  await expect(dialog.getByText("O Pulse não executa esse comando: copiar não aplica a autorização.", { exact: true })).toBeVisible();
  await expect(dialog.getByText("A página “Tela cheia automática” do Chrome apenas lista os sites:", { exact: false })).toBeVisible();
  expect(await dialog.locator('a[href^="chrome:"]').count()).toBe(0);
  await dialog.getByRole("button", { name: "Concluir" }).click();
  await expect(page.getByRole("button", { name: helpLabel })).toBeFocused();
  await expect(page.getByLabel("Nome da tela", { exact: true })).toHaveValue("Rascunho preservado");
  expect(state.writes).toHaveLength(0);
  expect(await page.locator("html").getAttribute("data-fullscreen-requested")).toBeNull();
});

test("permission updates on change, focus and manual check; unsupported is not misrepresented as denied", async ({ page }) => {
  await setup(page); await page.getByRole("button", { name: helpLabel }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByText("Tela cheia automática ainda não autorizada neste navegador.", { exact: true })).toBeVisible();
  await page.evaluate(() => window.dispatchEvent(new CustomEvent("test-permission", { detail: { state: "granted", notify: true } })));
  await expect(dialog.getByText("Tela cheia automática autorizada neste navegador.", { exact: true })).toBeVisible();
  await page.evaluate(() => {
    window.dispatchEvent(new CustomEvent("test-permission", { detail: { state: "denied" } }));
    window.dispatchEvent(new Event("focus"));
  });
  await expect(dialog.getByText("Tela cheia automática ainda não autorizada neste navegador.", { exact: true })).toBeVisible();
  await page.evaluate(() => window.dispatchEvent(new CustomEvent("test-permission", { detail: { queryFails: true } })));
  await dialog.getByRole("button", { name: "Verificar autorização" }).click();
  await expect(dialog.getByText("Este navegador não permite consultar a autorização automática.", { exact: true })).toBeVisible();
  await page.evaluate(() => Object.defineProperty(document, "fullscreenEnabled", { value: false, configurable: true }));
  await dialog.getByRole("button", { name: "Verificar autorização" }).click();
  await expect(dialog.getByText("Tela cheia indisponível neste navegador ou nesta janela.", { exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: helpLabel })).toBeFocused();
});

test("blocked clipboard selects the value for manual copying", async ({ page }) => {
  await setup(page); await page.getByRole("button", { name: helpLabel }).click();
  await page.evaluate(() => window.dispatchEvent(new Event("test-copy-fails")));
  const dialog = page.getByRole("dialog"), input = dialog.getByLabel(commandLabel, { exact: true });
  await dialog.getByRole("button", { name: `Copiar ${commandLabel.toLocaleLowerCase("pt-BR")}` }).click();
  await expect(dialog.getByText("Cópia automática indisponível.", { exact: false })).toBeVisible();
  await expect(input).toBeFocused();
  expect(await input.evaluate((element: HTMLTextAreaElement) => element.value.slice(element.selectionStart, element.selectionEnd))).toBe(await input.inputValue());
});

for (const width of [390, 1366]) test(`fullscreen help remains accessible at ${width}px and with zoom`, async ({ page }) => {
  await page.setViewportSize({ width, height: 900 }); await setup(page);
  await page.getByRole("button", { name: helpLabel }).click();
  const dialog = page.getByRole("dialog");
  await dialog.locator("summary").click();
  await dialog.getByRole("button", { name: `Copiar ${commandLabel.toLocaleLowerCase("pt-BR")}` }).scrollIntoViewIfNeeded();
  await expect(dialog.getByRole("button", { name: `Copiar ${commandLabel.toLocaleLowerCase("pt-BR")}` })).toBeVisible();
  expect(await dialog.evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
  await dialog.locator(".fullscreen-help-body").evaluate(element => { element.scrollTop = 0; });
  await page.screenshot({ path: `.cache/fullscreen-help-${width}.png` });
  if (width === 1366) {
    await page.evaluate(() => { document.documentElement.style.zoom = "2"; });
    expect(await dialog.evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
    await dialog.getByRole("button", { name: `Copiar ${commandLabel.toLocaleLowerCase("pt-BR")}` }).scrollIntoViewIfNeeded();
    await expect(dialog.getByRole("button", { name: `Copiar ${commandLabel.toLocaleLowerCase("pt-BR")}` })).toBeVisible();
  }
  await dialog.getByRole("button", { name: "Concluir" }).click();
  await expect(dialog).toHaveCount(0);
});
