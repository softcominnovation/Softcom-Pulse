import { test, expect, type Page } from "@playwright/test";
import { mkdir } from "node:fs/promises";

const key = "pulse.auth.v1";
async function enter(page: Page, email: string) {
  await page.goto("/login");
  await page.getByLabel("E-mail", { exact: true }).fill(email);
  await page.getByLabel("Senha", { exact: true }).fill("test-password");
  await page.getByRole("button", { name: "Entrar", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Toda a operação. Um só lugar." })).toBeVisible();
}
const sizes = [[1920,1080],[1366,768],[1024,768],[1023,768],[768,1024],[390,844],[320,640],[360,640],[640,450]];
for (const [width, height] of sizes) {
  test("login layout at " + width + "x" + height, async ({ page }) => {
    await page.setViewportSize({ width, height });
    const imageRequests: string[] = [];
    page.on("request", request => { if (request.url().includes("login-image")) imageRequests.push(request.url()); });
    await page.goto("/login");
    await expect(page.getByRole("heading", { name: "Entrar" })).toBeVisible();
    await expect(page.locator("html")).toHaveAttribute("lang", "pt-BR");
    await expect(page.locator("body")).toHaveCSS("background-color", "rgb(12, 17, 22)");
    const font = await page.locator("body").evaluate(node => getComputedStyle(node).fontFamily);
    expect(font).toContain("Segoe UI"); expect(font).not.toContain("Inter");
    const button = page.getByRole("button", { name: "Entrar", exact: true });
    await expect(button).toHaveCSS("background-color", "rgb(100, 214, 176)");
    await expect(button).toHaveCSS("border-radius", "7px");
    await expect(page.getByLabel("E-mail", { exact: true })).toHaveCSS("background-color", "rgb(24, 35, 44)");
    for (const control of [button, page.getByLabel("E-mail", { exact: true }), page.getByLabel("Senha", { exact: true })]) {
      expect((await control.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    }
    const reveal = page.getByRole("button", { name: "Mostrar senha", exact: true });
    await expect(reveal).toBeVisible();
    await expect(reveal.locator("svg")).toBeVisible();
    const inputBox = (await page.getByLabel("Senha", { exact: true }).boundingBox())!;
    const revealBox = (await reveal.boundingBox())!, iconBox = (await reveal.locator("svg").boundingBox())!;
    expect(revealBox.width).toBeGreaterThanOrEqual(44);
    expect(revealBox.height).toBeGreaterThanOrEqual(44);
    expect(revealBox.x).toBeGreaterThan(inputBox.x);
    expect(revealBox.x + revealBox.width).toBeLessThanOrEqual(inputBox.x + inputBox.width);
    expect(revealBox.y).toBe(inputBox.y);
    expect(revealBox.height).toBe(inputBox.height);
    expect(iconBox.width).toBeGreaterThanOrEqual(20);
    expect(Math.abs(iconBox.y + iconBox.height / 2 - inputBox.y - inputBox.height / 2)).toBeLessThan(1);
    const copyright = page.getByText(/© .*Softcom Tecnologia\. Todos os direitos reservados\./).filter({ visible: true });
    await expect(copyright).toHaveCount(1);
    await expect(page.getByRole("link", { name: "Softcom Tecnologia" })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    if (width >= 1024) {
      await expect(page.locator(".login-art")).toBeVisible();
      await expect.poll(() => page.locator("picture img").evaluate((node: HTMLImageElement) => node.complete && node.naturalWidth > 1)).toBe(true);
      const bounds = (await page.locator("picture img").boundingBox())!;
      expect(bounds.width).toBeLessThanOrEqual(320);
      expect(bounds.width / bounds.height).toBeCloseTo(4/3);
      expect(imageRequests.length).toBeGreaterThan(0);
    } else {
      await expect(page.locator(".login-art")).toBeHidden();
      expect(imageRequests).toHaveLength(0);
    }
    await mkdir(".cache/screenshots", { recursive: true });
    await page.screenshot({ path: ".cache/screenshots/login-" + width + ".png", fullPage: true });
  });
}
test("form validation, keyboard, error messages and loading prevent duplicate submission", async ({ page }) => {
  await page.goto("/login");
  await page.getByRole("button", { name: "Entrar", exact: true }).click();
  await expect(page.getByText("Informe um e-mail válido.")).toBeVisible();
  await expect(page.getByText("Informe sua senha.")).toBeVisible();
  await expect(page.getByLabel("E-mail", { exact: true })).toBeFocused();
  await expect(page.getByLabel("E-mail", { exact: true })).toHaveAttribute("aria-invalid", "true");
  await page.getByLabel("E-mail", { exact: true }).fill("slow-ui@example.test");
  await page.keyboard.press("Tab");
  await expect(page.getByLabel("Senha", { exact: true })).toBeFocused();
  await page.keyboard.type("test-password");
  await page.keyboard.press("Tab");
  await expect(page.getByRole("button", { name: "Mostrar senha", exact: true })).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(page.getByRole("button", { name: "Entrar", exact: true })).toBeFocused();
  await expect(page.getByRole("button", { name: "Entrar", exact: true })).toHaveCSS("outline-style", "solid");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("button", { name: "Entrando…" })).toBeDisabled();
  await expect(page.getByRole("heading", { name: "Toda a operação. Um só lugar." })).toBeVisible();
  expect(await (await page.request.get("http://127.0.0.1:3102/test-state?email=slow-ui@example.test")).json()).toMatchObject({ logins: 1 });
});
test("password visibility stays inside the input, supports keyboard and never submits the form", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/login");
  const password = page.getByLabel("Senha", { exact: true });
  await password.fill("test-secret-only");
  await expect(password).toHaveAttribute("type", "password");
  const before = (await password.boundingBox())!;
  const show = page.getByRole("button", { name: "Mostrar senha", exact: true });
  const button = (await show.boundingBox())!;
  expect(button.height).toBeGreaterThanOrEqual(44); expect(button.width).toBeGreaterThanOrEqual(44);
  expect(button.x).toBeGreaterThan(before.x); expect(button.x + button.width).toBeLessThanOrEqual(before.x + before.width);
  await password.focus(); await page.keyboard.press("Tab"); await expect(show).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(password).toHaveAttribute("type", "text");
  const hide = page.getByRole("button", { name: "Ocultar senha", exact: true });
  await expect(hide).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByText("Informe um e-mail válido.")).toHaveCount(0);
  await page.keyboard.press("Space");
  await expect(password).toHaveAttribute("type", "password");
  await expect(password).toHaveValue("test-secret-only");
  expect((await password.boundingBox())!.height).toBe(before.height);
  await show.click();
  await expect(password).toHaveAttribute("type", "text");
  await page.getByRole("button", { name: "Ocultar senha", exact: true }).click();
  await expect(password).toHaveAttribute("type", "password");
  await expect(page.getByText("Informe um e-mail válido.")).toHaveCount(0);
  await password.fill("");
  await page.screenshot({ path: ".cache/screenshots/login-password-toggle.png", fullPage: true });
});
test("rejected credentials remain in login without exposing the upstream error", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("E-mail", { exact: true }).fill("rejected@example.test");
  await page.getByLabel("Senha", { exact: true }).fill("wrong");
  await page.getByRole("button", { name: "Entrar", exact: true }).click();
  await expect(page.getByText("E-mail ou senha inválidos.").first()).toBeVisible();
  expect(page.url()).toContain("/login");
  expect(await page.locator("body").innerText()).not.toContain("raw-private-error");
});
test("BFF login, reload, protected shell and logout work without direct corporate calls", async ({ page }) => {
  const corporate: string[] = [];
  page.on("request", request => { if (new URL(request.url()).hostname === "api.softcom.cloud") corporate.push(request.url()); });
  await page.goto("/");
  await expect(page).toHaveURL(/\/login$/);
  await enter(page, "flow@example.test");
  const saved = JSON.parse((await page.evaluate(key => localStorage.getItem(key), key))!);
  expect(saved.session.accessToken).toMatch(/^v1\./);
  expect(saved.session.refreshToken).toMatch(/^v1\./);
  expect(JSON.stringify(saved)).not.toContain("test-raw-refresh");
  expect(JSON.stringify(saved)).not.toContain("test-signature");
  expect(saved.session.user.administrador).toBe(false);
  expect(saved.session.user.permissoes).toEqual([]);
  await page.reload();
  await expect(page.getByRole("heading", { name: "Toda a operação. Um só lugar." })).toBeVisible();
  await page.goto("/login");
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByText("FORTALEZA · UTC−3", { exact: true })).toBeVisible();
  await page.setViewportSize({ width: 320, height: 640 });
  await expect(page.getByRole("button", { name: "Sair", exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const logout = page.waitForResponse("**/api/auth/logout");
  await page.getByRole("button", { name: "Sair", exact: true }).click();
  expect((await logout).ok()).toBe(true);
  await expect(page).toHaveURL(/\/login$/);
  expect(JSON.parse((await page.evaluate(key => localStorage.getItem(key), key))!).session).toBeNull();
  expect(corporate).toHaveLength(0);
});
test("two real browser tabs rotate once, preserve thin user and synchronize logout", async ({ page, context }) => {
  await enter(page, "tabs@example.test");
  const other = await context.newPage();
  await other.goto("/");
  await expect(other.getByRole("heading", { name: "Toda a operação. Um só lugar." })).toBeVisible();
  await page.evaluate(key => {
    const record = JSON.parse(localStorage.getItem(key)!);
    record.session.expiresAt = Date.now() - 1;
    localStorage.setItem(key, JSON.stringify(record));
  }, key);
  await Promise.all([page.reload(), other.reload()]);
  await expect(page.getByRole("heading", { name: "Toda a operação. Um só lugar." })).toBeVisible();
  await expect(other.getByRole("heading", { name: "Toda a operação. Um só lugar." })).toBeVisible();
  const counters = await (await page.request.get("http://127.0.0.1:3102/test-state?email=tabs@example.test")).json();
  expect(counters.refreshes).toBe(1);
  const a = JSON.parse((await page.evaluate(key => localStorage.getItem(key), key))!).session;
  const b = JSON.parse((await other.evaluate(key => localStorage.getItem(key), key))!).session;
  expect(a.refreshToken).toBe(b.refreshToken);
  expect(a.user.empresa).toBe("JP");
  await other.getByRole("button", { name: "Sair", exact: true }).click();
  await expect(page).toHaveURL(/\/login$/);
  await expect(other).toHaveURL(/\/login$/);
});
test("direct HTTP BFF requests reject wrong purpose and tampered ciphertext", async ({ request }) => {
  const response = await request.post("/api/auth/login", { data: { email: "direct@example.test", senha: "test-password" } });
  expect(response.ok()).toBe(true);
  const data = await response.json();
  for (const token of [data.refreshToken, "corrupt", data.accessToken.replace(/^v1\./, "v2.")]) {
    const validation = await request.get("/api/auth/session", { headers: { Authorization: "Bearer " + token } });
    expect(validation.status()).toBe(401);
    expect(validation.headers()["cache-control"]).toBe("no-store");
  }
  expect((await request.post("/api/auth/refresh", { data: { refreshToken: data.accessToken } })).status()).toBe(401);
});
test("health remains available with safe dependency status", async ({ request }) => {
  const response = await request.get("/api/health");
  expect(response.status()).toBe(200);
  expect(await response.json()).toEqual({ status: "ok", checks: { database: "up", cache: "up" } });
  expect(response.headers()["cache-control"]).toContain("no-store");
});
