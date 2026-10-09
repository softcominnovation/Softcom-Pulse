import { randomBytes, randomUUID } from "node:crypto";
import { startAuthUpstream } from "../fixtures/auth-upstream.mjs";
import { before, test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { cp, mkdir, readFile, readdir, writeFile, unlink } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { createServer } from "node:net";
import { createServer as createHttpServer } from "node:http";
import { zabbixFixture } from "../fixtures/zabbix.mjs";
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
test("packaged collector publishes real Redis contracts, serves history and excludes concurrent workers", { timeout: 90000 }, async () => {
  const f = zabbixFixture(), databaseName = "pulse_runtime04_test_" + process.pid + "_" + Date.now();
  const scopeFile = new URL(".cache/" + databaseName + "-scope.json", root);
  const db = new URL(process.env.DATABASE_URL), redisUrl = new URL(process.env.REDIS_URL);
  for (const url of [db, redisUrl]) assert.ok(["127.0.0.1", "localhost", "[::1]"].includes(url.hostname));
  db.pathname = "/postgres"; redisUrl.pathname = "/12";
  const admin = new pg.Client({ connectionString: db.href }), cache = createClient({ url: redisUrl.href }); cache.on("error", () => {});
  const upstream = await startAuthUpstream(); let fail = false, created = false, owned = false;
  const leaseKey = "pulse:test:runtime04:lease", lease = randomUUID();
  const touched = new Set(); const children = new Set();
  const server = createHttpServer(async (request, response) => {
    try {
      const chunks = []; for await (const chunk of request) chunks.push(chunk);
      const { method, params, id } = JSON.parse(Buffer.concat(chunks));
      if (method !== "apiinfo.version") assert.equal(request.headers.authorization, "Bearer test-zabbix-only");
      response.setHeader("Content-Type", "application/json");
      response.end(JSON.stringify(fail ? { jsonrpc: "2.0", id, error: { code: -1, data: "private upstream" } } : { jsonrpc: "2.0", id, result: await f.rpc(method, params) }));
    } catch { response.writeHead(500); response.end(); }
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const worker = (args, environment, ipc = false) => {
    let output = "";
    const child = spawn(process.execPath, args, { cwd: fileURLToPath(standalone), env: { ...process.env, ...environment }, windowsHide: true, stdio: ["ignore", "pipe", "pipe", ...(ipc ? ["ipc"] : [])] }); children.add(child);
    child.stdout.on("data", data => { output += data; }); child.stderr.on("data", data => { output += data; });
    const done = new Promise((resolve, reject) => { child.once("error", reject); child.once("exit", code => { children.delete(child); resolve({ code, output }); }); });
    return { child, done, output: () => output };
  };
  try {
    await admin.connect(); await admin.query('CREATE DATABASE "' + databaseName + '"'); created = true; db.pathname = "/" + databaseName;
    await cache.connect(); assert.equal(await cache.set(leaseKey, lease, { NX: true, EX: 600 }), "OK"); owned = true; assert.equal(await cache.dbSize(), 1, "Redis DB 12 must be empty");
    await new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [fileURLToPath(new URL("node_modules/prisma/build/index.js", root)), "migrate", "deploy"], { cwd: fileURLToPath(root), env: { ...process.env, DATABASE_URL: db.href }, stdio: "ignore", windowsHide: true });
      child.once("error", reject); child.once("exit", code => code === 0 ? resolve() : reject(new Error("Migration failed")));
    });
    const environment = { DATABASE_URL: db.href, REDIS_URL: redisUrl.href, API_BASE_URL: upstream.url, ZABBIX_API_URL: `http://127.0.0.1:${server.address().port}/api_jsonrpc.php`, ZABBIX_API_TOKEN: "test-zabbix-only" };
    await writeFile(scopeFile, JSON.stringify(f.scope));
    const scope = await worker(["--conditions=react-server", "collector/configure-scope.mjs", fileURLToPath(scopeFile)], environment).done; assert.equal(scope.code, 0, scope.output);
    const check = await worker(["--conditions=react-server", "collector/index.mjs", "--check"], { ...environment, DATABASE_URL: "", REDIS_URL: "", ZABBIX_API_URL: "", ZABBIX_API_TOKEN: "" }).done;
    assert.equal(check.code, 0, check.output);
    const first = await worker(["--conditions=react-server", "collector/index.mjs", "--once"], environment).done; assert.equal(first.code, 0, first.output);
    const sync = JSON.parse(await cache.get("pulse:sync:last")); sync.data.keys.forEach(key => touched.add(key)); touched.add("pulse:sync:last");
    await withServer(environment, async base => {
      const login = await fetch(base + "/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: "collector@example.test", senha: "test-password" }) });
      assert.equal(login.status, 200); const auth = { Authorization: "Bearer " + (await login.json()).accessToken };
      const overview = await fetch(base + "/api/dashboard/overview", { headers: auth }); assert.equal(overview.status, 200); assert.equal((await overview.json()).data.summary.containersStopped, 4);
      const hosts = await (await fetch(base + "/api/monitoring/hosts", { headers: auth })).json(); const vmKey = hosts.data[0].vms[0].vmKey;
      for (const path of ["/api/monitoring/hosts/ASGARD/history?range=7d", "/api/monitoring/hosts/ASGARD/vms/" + vmKey + "/history?range=1h"]) {
        const response = await fetch(base + path, { headers: auth }); assert.equal(response.status, 200, path); const history = await response.json(); assert.equal(history.availability, "ready"); assert.ok(!JSON.stringify(history).includes('"itemid"'));
      }
      const before = await cache.get("pulse:inventory:hosts"); fail = true;
      const failed = await worker(["--conditions=react-server", "collector/index.mjs", "--once"], environment).done; assert.equal(failed.code, 1); assert.ok(!failed.output.includes("private upstream")); assert.equal(await cache.get("pulse:inventory:hosts"), before);
      assert.equal((await (await fetch(base + "/api/dashboard/overview", { headers: auth })).json()).stale, true);
      fail = false;
    });
    const held = worker(["--conditions=react-server", "--input-type=module", "-e", 'import {runCollector} from "./collector/worker.ts"; process.once("message",()=>process.emit("SIGTERM")); await runCollector(); process.disconnect();'], environment, true);
    for (let i = 0; i < 500 && !held.output().includes("collector_cycle"); i++) await delay(20);
    assert.ok(held.output().includes("collector_cycle"));
    const duplicate = await worker(["--conditions=react-server", "collector/index.mjs", "--once"], environment).done;
    assert.equal(duplicate.code, 1); assert.ok(duplicate.output.includes("collector_already_running"));
    held.child.send("stop");
    const stopped = await held.done; assert.equal(stopped.code, 0, stopped.output);
    const resumed = await worker(["--conditions=react-server", "collector/index.mjs", "--once"], environment).done; assert.equal(resumed.code, 0, resumed.output);
  } finally {
    for (const child of children) child.kill();
    await upstream.close(); await new Promise(resolve => server.close(resolve));
    if (cache.isReady) { if (owned && await cache.get(leaseKey) === lease) { if (touched.size) await cache.del([...touched]); await cache.del(leaseKey); } await cache.quit(); }
    assert.match(databaseName, /^pulse_runtime04_test_\d+_\d+$/); if (created) await admin.query('DROP DATABASE "' + databaseName + '" WITH (FORCE)'); await admin.end();
    await unlink(scopeFile).catch(() => {});
  }
});

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
  const privateValues = [privateCanary, authKey, process.env.TOKEN_ENCRYPTION_KEY, process.env.API_BASE_URL, process.env.CORPORATE_API_URL, process.env.DATABASE_URL, process.env.REDIS_URL, process.env.ZABBIX_API_URL, process.env.ZABBIX_API_TOKEN, "ZABBIX_API_URL", "ZABBIX_API_TOKEN"].filter(value => value && value.length > 8);
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
      for (const asset of ["/logo.png", "/logo.svg", "/logo.ico", "/images/login-image.png", "/images/softcom-logo.png", "/images/404.png"]) assert.equal((await fetch(base + asset)).status, 200);
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
    const environment = { DATABASE_URL: db.href, REDIS_URL: redisUrl.href, API_BASE_URL: upstream.url, PULSE_EDITOR_EMAILS: "bff-runtime@example.test" };
    await withServer(environment, async base => {
      const login = await fetch(base + "/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: "bff-runtime@example.test", senha: "test-password" }) });
      assert.equal(login.status, 200); auth = { Authorization: "Bearer " + (await login.json()).accessToken, "Content-Type": "application/json" };
      const uuid = randomUUID();
      const templateKey = "vm-" + "0".repeat(32);
      for (const path of ["/settings/templates", "/monitoring/templates", "/monitoring/templates/" + templateKey, "/settings/presentation", "/dashboard/overview", "/monitoring/hosts", "/monitoring/hosts/asgard", "/monitoring/hosts/asgard/history", "/monitoring/hosts/asgard/containers", "/monitoring/hosts/asgard/vms/101/history", "/monitoring/containers", "/monitoring/problems", "/monitoring/services", "/monitoring/services/" + uuid, "/monitoring/services/" + uuid + "/history"]) {
        assert.equal((await fetch(base + "/api" + path)).status, 401, path);
      }
      const initial = await fetch(base + "/api/settings/presentation", { headers: auth }); assert.equal(initial.status, 200);
      const { data: first } = await initial.json();
      const { revision, ...settings } = first;
      settings.screens[0].name = "Apresentação compartilhada"; settings.rotation.intervalSeconds = 35;
      const put = await fetch(base + "/api/settings/presentation", { method: "PUT", headers: auth, body: JSON.stringify({ expectedRevision: revision, settings }) });
      assert.equal(put.status, 200); saved = await put.json();
      assert.equal((await fetch(base + "/api/settings/presentation", { method: "PUT", headers: auth, body: JSON.stringify({ expectedRevision: revision, settings }) })).status, 409);
      // createResource requires a ready hosts snapshot; seed briefly then clear so later GETs still see no_data.
      const observedAt = new Date().toISOString(), generation = randomUUID();
      const hostsKey = "pulse:inventory:hosts", syncKey = "pulse:sync:last";
      const wrap = data => JSON.stringify({ data, updatedAt: observedAt, source: "zabbix", generation });
      const runtimeHost = {
        hostKey: "runtime-host", name: "runtime-host", role: "unknown", availability: "reachable",
        metrics: { cpuUsagePercent: { value: 0, unit: "percent", observedAt, quality: "fresh" } },
        storages: [], filesystems: [], interfaces: [], vms: [], evidence: { source: "zabbix", observedAt, basis: "item" },
      };
      const inventory = createClient({ url: redisUrl.href }); inventory.on("error", () => {});
      await inventory.connect();
      try {
        await inventory.set(hostsKey, wrap([runtimeHost]), { EX: 300 });
        await inventory.set(syncKey, wrap({ status: "ok", lastSuccessfulAt: observedAt, lastAttemptAt: observedAt, error: null, keys: [hostsKey] }), { EX: 300 });
        const post = await fetch(base + "/api/monitoring/services", { method: "POST", headers: auth, body: JSON.stringify({ resourceType: "host", zabbixHostKey: "runtime-host", displayName: "Runtime" }) });
        assert.equal(post.status, 201, await post.clone().text()); resourceId = (await post.json()).data.id;
      } finally {
        await inventory.del([hostsKey, syncKey]);
        await inventory.quit();
      }
      const edit = await fetch(base + "/api/monitoring/services/" + resourceId, { method: "PATCH", headers: auth, body: JSON.stringify({ displayName: "Persistido" }) }); assert.equal(edit.status, 200);
      for (const path of ["/monitoring/templates", "/monitoring/hosts", "/monitoring/containers", "/monitoring/problems", "/monitoring/services", "/monitoring/services/" + resourceId, "/monitoring/services/" + resourceId + "/history"]) {
        const response = await fetch(base + "/api" + path, { headers: auth }); assert.equal(response.status, 200, path);
        assert.equal((await response.json()).availability, "no_data");
      }
      const metadata = await fetch(base + "/api/settings/templates", { headers: auth });
      assert.equal(metadata.status, 200); assert.deepEqual((await metadata.json()).data, []);
      const templateWrite = { method: "PUT", body: JSON.stringify({ expectedRevision: 0, displayName: "Template de teste", roleOverride: null }) };
      assert.equal((await fetch(base + "/api/settings/templates/" + templateKey, templateWrite)).status, 401);
      const undiscovered = await fetch(base + "/api/settings/templates/" + templateKey, { ...templateWrite, headers: auth });
      assert.equal(undiscovered.status, 409); assert.deepEqual(await undiscovered.json(), { error: { code: "template_inventory_unavailable" } });
      assert.equal((await fetch(base + "/api/monitoring/templates/" + templateKey, { headers: auth })).status, 404);
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
