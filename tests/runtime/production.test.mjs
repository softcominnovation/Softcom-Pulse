import { randomBytes, randomUUID } from "node:crypto";
import { startAuthUpstream } from "../fixtures/auth-upstream.mjs";
import { before, test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { cp, mkdir, readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { createServer } from "node:net";
import { setTimeout as delay } from "node:timers/promises";
import pg from "pg";
import { createClient } from "redis";

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

test("standalone persists configuration across restarts and serves every protected BFF route", { timeout: 60000 }, async () => {
  const dbName = "pulse_runtime03_test_" + process.pid + "_" + Date.now();
  const db = new URL(process.env.DATABASE_URL), redisUrl = new URL(process.env.REDIS_URL);
  for (const url of [db, redisUrl]) assert.ok(["127.0.0.1", "localhost", "[::1]"].includes(url.hostname));
  db.pathname = "/postgres";
  const admin = new pg.Client({ connectionString: db.href });
  const upstream = await startAuthUpstream();
  let created = false, saved, auth, resourceId;
  try {
    await admin.connect(); await admin.query('CREATE DATABASE "' + dbName + '"'); created = true;
    db.pathname = "/" + dbName;
    redisUrl.pathname = "/14";
    const cache = createClient({ url: redisUrl.href }); cache.on("error", () => {});
    try { await cache.connect(); assert.equal(await cache.dbSize(), 0, "Redis DB 14 must be empty for read-only runtime tests"); }
    finally { if (cache.isOpen) await cache.quit(); }
    await new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [fileURLToPath(new URL("node_modules/prisma/build/index.js", root)), "migrate", "deploy"], {
        cwd: fileURLToPath(root), env: { ...process.env, DATABASE_URL: db.href }, stdio: "ignore", windowsHide: true,
      });
      child.on("error", reject); child.on("exit", code => code === 0 ? resolve() : reject(new Error("Runtime test migration failed")));
    });
    const environment = { DATABASE_URL: db.href, REDIS_URL: redisUrl.href, API_BASE_URL: upstream.url };
    await withServer(environment, async base => {
      const login = await fetch(base + "/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: "bff-runtime@example.test", senha: "test-password" }) });
      assert.equal(login.status, 200); auth = { Authorization: "Bearer " + (await login.json()).accessToken, "Content-Type": "application/json" };
      const uuid = randomUUID();
      for (const path of ["/settings/presentation", "/dashboard/overview", "/monitoring/hosts", "/monitoring/hosts/asgard", "/monitoring/hosts/asgard/history", "/monitoring/hosts/asgard/containers", "/monitoring/hosts/asgard/vms/101/history", "/monitoring/containers", "/monitoring/problems", "/monitoring/services", "/monitoring/services/" + uuid, "/monitoring/services/" + uuid + "/history"]) {
        assert.equal((await fetch(base + "/api" + path)).status, 401, path);
      }
      const initial = await fetch(base + "/api/settings/presentation", { headers: auth }); assert.equal(initial.status, 200);
      const { data: first } = await initial.json();
      const { revision, ...settings } = first;
      settings.screens[0].name = "Apresentação compartilhada"; settings.rotation.intervalSeconds = 35;
      const put = await fetch(base + "/api/settings/presentation", { method: "PUT", headers: auth, body: JSON.stringify({ expectedRevision: revision, settings }) });
      assert.equal(put.status, 200); saved = await put.json();
      assert.equal((await fetch(base + "/api/settings/presentation", { method: "PUT", headers: auth, body: JSON.stringify({ expectedRevision: revision, settings }) })).status, 409);
      const post = await fetch(base + "/api/monitoring/services", { method: "POST", headers: auth, body: JSON.stringify({ resourceType: "host", zabbixHostKey: "runtime-host", displayName: "Runtime" }) });
      assert.equal(post.status, 201); resourceId = (await post.json()).data.id;
      const edit = await fetch(base + "/api/monitoring/services/" + resourceId, { method: "PATCH", headers: auth, body: JSON.stringify({ displayName: "Persistido" }) }); assert.equal(edit.status, 200);
      for (const path of ["/monitoring/hosts", "/monitoring/containers", "/monitoring/problems", "/monitoring/services", "/monitoring/services/" + resourceId, "/monitoring/services/" + resourceId + "/history"]) {
        const response = await fetch(base + "/api" + path, { headers: auth }); assert.equal(response.status, 200, path);
        assert.equal((await response.json()).availability, "no_data");
      }
      const overview = await fetch(base + "/api/dashboard/overview?screenId=" + first.screens[0].id, { headers: auth });
      assert.equal(overview.status, 200); assert.equal((await overview.json()).data.blocks.length, 4);
      assert.equal((await fetch(base + "/api/monitoring/hosts/missing/history", { headers: auth })).status, 404);
    });
    await withServer(environment, async base => {
      assert.deepEqual(await (await fetch(base + "/api/settings/presentation", { headers: { ...auth, "User-Agent": "second-device" } })).json(), saved);
      const resource = await (await fetch(base + "/api/monitoring/services/" + resourceId, { headers: auth })).json(); assert.equal(resource.data.config.displayName, "Persistido");
      assert.equal((await fetch(base + "/api/monitoring/services/" + resourceId, { method: "DELETE", headers: auth })).status, 204);
      assert.equal((await fetch(base + "/api/monitoring/services/" + resourceId, { headers: auth })).status, 404);
    });
    const broken = new URL(db.href); broken.port = "1";
    await withServer({ ...environment, DATABASE_URL: broken.href }, async base => {
      const response = await fetch(base + "/api/settings/presentation", { headers: auth }); assert.equal(response.status, 503);
      assert.deepEqual(await response.json(), { error: { code: "database_unavailable" } });
    });
  } finally {
    await upstream.close();
    assert.match(dbName, /^pulse_runtime03_test_\d+_\d+$/);
    if (created) await admin.query('DROP DATABASE "' + dbName + '" WITH (FORCE)');
    await admin.end();
  }
});
