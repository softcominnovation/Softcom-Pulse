import { randomBytes } from "node:crypto";
import { startAuthUpstream } from "../fixtures/auth-upstream.mjs";
import { before, test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { cp, mkdir, readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { createServer } from "node:net";
import { setTimeout as delay } from "node:timers/promises";

const root = new URL("../../", import.meta.url);
const standalone = new URL(".next/standalone/", root);
process.env.PLAYWRIGHT_BROWSERS_PATH ??= fileURLToPath(new URL(".cache/ms-playwright", root));
const { chromium } = await import("@playwright/test");
const authKey = randomBytes(32).toString("base64");
const privateCanary = "pulse-private-runtime-canary-734021";
before(async () => {
  await cp(new URL("public/", root), new URL("public/", standalone), { recursive: true });
  await cp(new URL(".next/static/", root), new URL(".next/static/", standalone), { recursive: true });
  await mkdir(new URL(".cache/screenshots/", root), { recursive: true });
});
async function freePort() {
  const server = createServer();
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return port;
}
async function withServer(environment, run) {
  const port = await freePort();
  const child = spawn(process.execPath, [fileURLToPath(new URL("server.js", standalone))], {
    cwd: fileURLToPath(standalone), windowsHide: true, stdio: "ignore",
    env: { ...process.env, NODE_ENV: "production", PORT: String(port), HOSTNAME: "127.0.0.1", TOKEN_ENCRYPTION_KEY: authKey, ZABBIX_API_TOKEN: privateCanary, ...environment },
  });
  const exited = new Promise(resolve => child.once("exit", resolve));
  let spawnError;
  child.once("error", error => { spawnError = error; });
  const base = "http://127.0.0.1:" + port;
  try {
    let ready = false;
    for (let i = 0; i < 150; i++) {
      if (spawnError || child.exitCode !== null) throw new Error("Production server could not start.");
      if (await fetch(base).then(response => response.ok).catch(() => false)) { ready = true; break; }
      await delay(100);
    }
    assert.ok(ready, "Production server did not become ready.");
    await run(base);
  } finally {
    child.kill();
    await exited;
  }
}
test("one standalone build accepts different public runtime settings", { timeout: 60000 }, async () => {
  const browser = await chromium.launch();
  try {
    for (const [name, link] of [["Pulse Alpha", "https://example.org/alpha"], ["Pulse Beta", "https://example.org/beta"]]) {
      await withServer({ NEXT_PUBLIC_APP_NAME: name, NEXT_PUBLIC_SOFTCOM_URL: link }, async base => {
        const response = await fetch(base);
        const html = await response.text();
        assert.ok(!html.includes(privateCanary));
        assert.ok(html.includes("appName") && html.includes("softcomUrl"));
        const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
        const errors = [];
        page.on("pageerror", error => errors.push(error.message));
        await page.goto(base + "/login");
        assert.equal(await page.locator("h1").innerText(), "Entrar");
        assert.ok(await page.getByText(name, { exact: true }).first().isVisible());
        assert.equal(await page.title(), name);
        assert.equal(await page.getByRole("link", { name: "Softcom Tecnologia" }).getAttribute("href"), link);
        assert.equal((await fetch(base + "/api/health")).status, 200);
        assert.deepEqual(errors, []);
        await page.close();
      });
    }
    await withServer({ NEXT_PUBLIC_APP_NAME: "Softcom Pulse" }, async base => {
      for (const width of [390, 1440]) {
        const page = await browser.newPage({ viewport: { width, height: 900 } });
        await page.goto(base);
        await page.getByRole("heading", { name: "Entrar" }).waitFor();
        await page.waitForFunction(() => {
          const images = [...document.images].filter(image => image.getBoundingClientRect().width > 0);
          return images.length > 0 && images.every(image => image.complete && image.naturalWidth > 0);
        });
        await page.screenshot({ path: fileURLToPath(new URL(".cache/screenshots/standalone-login-" + width + ".png", root)), fullPage: true });
        await page.close();
      }
    });
  } finally { await browser.close(); }
});
test("real HTTP health failure distinguishes database and cache without leaking private configuration", { timeout: 30000 }, async () => {
  const unavailableDb = new URL(process.env.DATABASE_URL);
  unavailableDb.port = "1";
  for (const [environment, checks] of [
    [{ DATABASE_URL: unavailableDb.href }, { database: "down", cache: "up" }],
    [{ REDIS_URL: "redis://127.0.0.1:1" }, { database: "up", cache: "down" }],
  ]) {
    await withServer(environment, async base => {
      const response = await fetch(base + "/api/health");
      assert.equal(response.status, 503);
      assert.deepEqual(await response.json(), { status: "unavailable", checks });
    });
  }
});
test("browser bundles do not contain private environment values", async () => {
  const privateValues = [privateCanary, authKey, process.env.TOKEN_ENCRYPTION_KEY, process.env.API_BASE_URL, process.env.CORPORATE_API_URL, process.env.DATABASE_URL, process.env.REDIS_URL, process.env.ZABBIX_API_TOKEN].filter(value => value && value.length > 8);
  async function inspect(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = new URL(entry.name + (entry.isDirectory() ? "/" : ""), directory);
      if (entry.isDirectory()) await inspect(path);
      else if (/\.(js|css|json)$/.test(entry.name)) {
        const source = await readFile(path, "utf8");
        for (const value of privateValues) assert.ok(!source.includes(value), "A private value appeared in a browser artifact.");
      }
    }
  }
  await inspect(new URL(".next/static/", root));
});

test("standalone serves packaged login assets and authenticates through the BFF", { timeout: 60000 }, async () => {
  const upstream = await startAuthUpstream();
  const browser = await chromium.launch();
  try {
    await withServer({ API_BASE_URL: upstream.url }, async base => {
      for (const asset of ["/logo.png", "/logo.svg", "/logo.ico", "/images/login-image.png", "/images/softcom-logo.png"]) assert.equal((await fetch(base + asset)).status, 200);
      const page = await browser.newPage({ viewport: { width: 1366, height: 768 } });
      await page.goto(base + "/login");
      await page.getByLabel("E-mail", { exact: true }).fill("standalone@example.test");
      await page.getByLabel("Senha", { exact: true }).fill("test-password");
      await page.getByRole("button", { name: "Entrar", exact: true }).click();
      await page.getByRole("heading", { name: "Dashboard" }).waitFor();
      const saved = JSON.parse(await page.evaluate(() => localStorage.getItem("pulse.auth.v1")));
      assert.ok(saved.session.accessToken.startsWith("v1."));
      assert.ok(!JSON.stringify(saved).includes("test-raw-refresh"));
      const original = saved.session.refreshToken;
      const rotated = await fetch(base + "/api/auth/refresh", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ refreshToken: original }) });
      assert.equal(rotated.status, 200);
      const next = await rotated.json();
      assert.deepEqual(next.user, saved.session.user);
      assert.notEqual(next.refreshToken, original);
      assert.equal((await fetch(base + "/api/auth/refresh", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ refreshToken: original }) })).status, 401);
      const closed = await fetch(base + "/api/auth/logout", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ refreshToken: next.refreshToken }) });
      assert.deepEqual(await closed.json(), { revoked: true });
      assert.equal((await fetch(base + "/api/auth/refresh", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ refreshToken: next.refreshToken }) })).status, 401);
      await page.screenshot({ path: fileURLToPath(new URL(".cache/screenshots/dashboard-1366.png", root)), fullPage: true });
      await page.close();
    });
  } finally { await browser.close(); await upstream.close(); }
});
