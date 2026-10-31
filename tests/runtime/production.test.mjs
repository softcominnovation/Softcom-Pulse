import { randomBytes, randomUUID } from "node:crypto";
import { startAuthUpstream } from "../fixtures/auth-upstream.mjs";
import { before, test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { cp, mkdir, readFile, readdir, writeFile, unlink } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { createServer } from "node:net";
import { createServer as createHttpServer } from "node:http";
import { zabbixFixture } from "../fixtures/zabbix.mjs";
import { getWithHost } from "../fixtures/http-host.mjs";
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
    await Promise.race([exited, delay(500).then(() => { child.kill("SIGKILL"); return exited; })]);
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
    touched.add("pulse:discovery:agent-candidates");
    await new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [fileURLToPath(new URL("node_modules/prisma/build/index.js", root)), "migrate", "deploy"], { cwd: fileURLToPath(root), env: { ...process.env, DATABASE_URL: db.href }, stdio: "ignore", windowsHide: true });
      child.once("error", reject); child.once("exit", code => code === 0 ? resolve() : reject(new Error("Migration failed")));
    });
    const environment = { DATABASE_URL: db.href, REDIS_URL: redisUrl.href, API_BASE_URL: upstream.url, ZABBIX_API_URL: `http://127.0.0.1:${server.address().port}/api_jsonrpc.php`, ZABBIX_API_TOKEN: "test-zabbix-only", TOKEN_ENCRYPTION_KEY: authKey, PULSE_EDITOR_EMAILS: "collector@example.test" };
    await writeFile(scopeFile, JSON.stringify(f.scope));
    const scope = await worker(["--conditions=react-server", "collector/configure-scope.mjs", fileURLToPath(scopeFile)], environment).done; assert.equal(scope.code, 0, scope.output);
    const check = await worker(["--conditions=react-server", "collector/index.mjs", "--check"], { ...environment, DATABASE_URL: "", REDIS_URL: "", ZABBIX_API_URL: "", ZABBIX_API_TOKEN: "" }).done;
    assert.equal(check.code, 0, check.output);
    const first = await worker(["--conditions=react-server", "collector/index.mjs", "--once"], environment).done; assert.equal(first.code, 0, first.output);
    const sync = JSON.parse(await cache.get("pulse:sync:last")); [...sync.data.keys, ...(sync.data.extensionKeys ?? [])].forEach(key => touched.add(key)); touched.add("pulse:sync:last");
    try {
      for (const phase of ["healthy", "candidate", "confirmed"]) {
        const result = await worker(["--conditions=react-server", fileURLToPath(new URL("tests/fixtures/notification-worker.mjs", root)), phase], environment).done;
        assert.equal(result.code, 0, result.output);
      }
    } finally { for (const key of await cache.keys("pulse:*")) if (key !== leaseKey) touched.add(key); }
    await withServer(environment, async base => {
      const login = await fetch(base + "/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: "collector@example.test", senha: "test-password" }) });
      assert.equal(login.status, 200); const auth = { Authorization: "Bearer " + (await login.json()).accessToken };
      const notifications = await (await fetch(base + "/api/monitoring/notifications", { headers: auth })).json();
      assert.equal(notifications.counts.unreadCount, 3); assert.equal(notifications.counts.activeCount, 3);
      const read = await fetch(base + "/api/monitoring/notifications/read", { method: "POST", headers: { ...auth, "Content-Type": "application/json" }, body: JSON.stringify({ ids: [notifications.events[0].id] }) });
      assert.equal(read.status, 200); assert.equal((await read.json()).counts.unreadCount, 2);
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
    await withServer({ ...environment, PULSE_PUBLIC_HOSTS: "127.0.0.1" }, async base => {
      const response = await fetch(base + "/api/public/monitoring/notifications"); assert.equal(response.status, 200);
      const restored = await response.json(); assert.equal(restored.counts.unreadCount, 2); assert.equal(restored.counts.activeCount, 3);
    });
  } finally {
    for (const child of children) child.kill();
    await upstream.close(); await new Promise(resolve => server.close(resolve));
    if (cache.isReady) { if (owned && await cache.get(leaseKey) === lease) { if (touched.size) await cache.del([...touched]); await cache.del(leaseKey); } await cache.quit(); }
    assert.match(databaseName, /^pulse_runtime04_test_\d+_\d+$/); if (created) await admin.query('DROP DATABASE "' + databaseName + '" WITH (FORCE)'); await admin.end();
    await unlink(scopeFile).catch(() => {});
  }
});

test("public monitor supports isolated iframe origins and blocked storage in production", { timeout: 60000 }, async t => {
  const browser = await chromium.launch();
  try {
    // Next dev intentionally refuses opaque-origin asset requests; exercise the shipped server.
    await withServer({ PULSE_DEMO_MODE: "1", PULSE_E2E: "", PULSE_PUBLIC_HOSTS: "127.0.0.1", DATABASE_URL: "postgresql://unused:unused@127.0.0.1:1/unused", REDIS_URL: "redis://127.0.0.1:1" }, async base => {
      const parent = createHttpServer((request, response) => {
        const isolated = new URL(request.url, "http://localhost").searchParams.has("isolated");
        response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        response.end(`<!doctype html><iframe title="Pulse" ${isolated ? 'sandbox="allow-scripts"' : ""} src="${base}/monitor?compat=0" width="1366" height="768"></iframe>`);
      });
      await new Promise(resolve => parent.listen(0, "127.0.0.1", resolve));
      try {
        for (const mode of ["cross-origin", "blocked-storage", "isolated-origin"]) {
          const context = await browser.newContext({ viewport: { width: 1366, height: 768 } });
          try {
            if (mode === "blocked-storage") await context.addInitScript(origin => {
              if (location.origin !== origin) return;
              for (const key of ["localStorage", "sessionStorage"]) Object.defineProperty(window, key, {
                configurable: true,
                get() { throw new DOMException("Storage unavailable", "SecurityError"); },
              });
              Object.defineProperty(document, "cookie", { configurable: true, get() { throw new DOMException("Cookies unavailable", "SecurityError"); } });
            }, base);
            const page = await context.newPage(), errors = [], requests = [];
            page.on("pageerror", error => errors.push(error.message));
            page.on("request", request => { if (new URL(request.url()).pathname.startsWith("/api/")) requests.push(request); });
            const configuration = page.waitForResponse(response => new URL(response.url()).pathname === "/api/public/settings/presentation", { timeout: 12000 });
            const loaded = page.waitForResponse(response => new URL(response.url()).pathname === "/api/public/dashboard/overview", { timeout: 12000 });
            await page.goto(`http://127.0.0.1:${parent.address().port}/${mode === "isolated-origin" ? "?isolated" : ""}`);
            const response = await loaded;
            assert.equal(response.status(), 200, mode);
            assert.ok((await response.json()).data.blocks.length > 0, mode);
            if (mode === "isolated-origin") {
              assert.equal((await response.request().allHeaders()).origin, "null");
              assert.equal(response.headers()["access-control-allow-origin"], "*");
            }
            const frame = page.frameLocator('iframe[title="Pulse"]');
            await frame.locator(".dashboard-blocks:not([aria-busy=true])").waitFor({ state: "visible" });
            const { data: settings } = await (await configuration).json();
            assert.equal(await frame.getByRole("button", { name: settings.defaultTvMode ? "Sair do modo TV" : "Modo TV", exact: true }).getAttribute("aria-pressed"), String(settings.defaultTvMode), mode);
            assert.equal(await frame.getByText("Carregando as telas configuradas…", { exact: true }).count(), 0, mode);
            assert.deepEqual(errors, [], mode);
            assert.ok(requests.every(request => request.method() === "GET" && new URL(request.url()).pathname.startsWith("/api/public/")), mode);
            t.diagnostic(`Production iframe loaded: ${mode}`);
          } finally { await context.close(); }
        }
      } finally { await new Promise(resolve => parent.close(resolve)); }
    });
  } finally { await browser.close(); }
});

test("compatible monitor serves data without Next bundles, including opaque iframe and no-JS clients", { timeout: 90000 }, async t => {
  // A spoofed UA verifies routing. Actual old-engine coverage still requires the target TV.
  const userAgent = "Mozilla/5.0 (Linux; Android 10; TV) AppleWebKit/537.36 Version/4.0 Chrome/83.0.4103.120 Safari/537.36";
  const browser = await chromium.launch();
  try {
    await withServer({ PULSE_DEMO_MODE: "1", PULSE_E2E: "", PULSE_PUBLIC_HOSTS: "127.0.0.1", DATABASE_URL: "postgresql://unused:unused@127.0.0.1:1/unused", REDIS_URL: "redis://127.0.0.1:1" }, async base => {
      const parent = createHttpServer((_request, response) => {
        response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        response.end(`<!doctype html><iframe title="Pulse compatível" sandbox="allow-scripts" src="${base}/monitor" width="1366" height="768"></iframe>`);
      });
      await new Promise(resolve => parent.listen(0, "127.0.0.1", resolve));
      try {
        for (const mode of ["old-ua", "forced", "no-js", "isolated", "iframe-modern", "blocked-storage", "capability-fallback", "blocked-audio", "no-web-audio"]) {
          const modern = ["forced", "capability-fallback", "iframe-modern"].includes(mode);
          const context = await browser.newContext({ viewport: { width: 1366, height: 768 }, ...(modern ? {} : { userAgent }), javaScriptEnabled: mode !== "no-js" });
          try {
            if (mode === "blocked-storage") await context.addInitScript(() => {
              for (const key of ["localStorage", "sessionStorage"]) Object.defineProperty(window, key, { configurable: true, get() { throw new DOMException("Unavailable", "SecurityError"); } });
              Object.defineProperty(document, "cookie", { configurable: true, get() { throw new DOMException("Unavailable", "SecurityError"); } });
            });
            if (mode === "capability-fallback") await context.addInitScript(() => { window.CSS.supports = () => false; });
            if (mode === "no-web-audio") await context.addInitScript(() => {
              window.AudioContext = undefined; window.webkitAudioContext = undefined;
            });
            const page = await context.newPage(), errors = [], requests = [];
            if (mode === "blocked-audio") await page.route("**/monitor-compat-audio.js", route => route.abort());
            page.on("pageerror", error => errors.push(error.message));
            page.on("request", request => requests.push(request));
            const embedded = mode === "isolated" || mode === "iframe-modern";
            const url = embedded ? `http://127.0.0.1:${parent.address().port}/` : base + "/monitor" + (mode === "forced" ? "?compat=1" : "");
            const response = await page.goto(url);
            assert.equal(response.status(), 200, response.status() === 200 ? mode : `${mode}: ${(await response.text()).slice(0, 300)}`);
            const surface = embedded ? page.frameLocator('iframe[title="Pulse compatível"]') : page;
            await surface.locator("#compat-content .dashboard-blocks").waitFor({ state: "visible" });
            await surface.getByRole("heading", { name: "Disponibilidade de Serviços", exact: true }).waitFor({ state: "visible" });
            assert.ok(await surface.locator(".availability-card").count() > 0, mode);
            assert.ok(await surface.locator(".panel-icon svg[data-icon]").count() > 0, mode);
            assert.equal(await surface.locator('#compat-tv svg[data-icon="tv"]').isVisible(), true, mode);
            assert.equal(await surface.locator("#compat-volume").isVisible(), true, mode);
            if (mode === "no-js") assert.equal(await surface.locator("#compat-volume").isDisabled(), true);
            const html = await surface.locator("#compat-content").innerHTML();
            assert.ok(!html.includes(privateCanary), mode);
            if (mode !== "no-js") {
              await surface.locator(".availability-card").first().click();
              await surface.getByRole("dialog").waitFor({ state: "visible" });
              await surface.getByRole("button", { name: "Fechar", exact: true }).click();
              const refreshed = page.waitForResponse(response => new URL(response.url()).pathname === "/monitor/compat" && new URL(response.url()).searchParams.get("fragment") === "1");
              await surface.getByRole("link", { name: "Atualizar", exact: true }).click();
              const fragment = await refreshed;
              assert.equal(fragment.status(), 200, mode); assert.equal(fragment.headers()["cache-control"], "no-store");
              assert.ok((await fragment.json()).html.includes("Disponibilidade de Serviços"), mode);
              if (embedded) {
                assert.equal((await fragment.request().allHeaders()).origin, "null");
                assert.equal(fragment.headers()["access-control-allow-origin"], "*");
              }
              if (mode === "blocked-audio") {
                await surface.locator('#compat-audio[data-audio-state="unavailable"]').waitFor();
                assert.equal(await surface.locator("#compat-volume").isDisabled(), true);
                assert.equal(await surface.getByText("Áudio indisponível", { exact: true }).isVisible(), true);
              } else {
                await surface.getByRole("button", { name: "Som ativo", exact: true }).click();
                assert.equal(await surface.locator('#compat-volume-off svg[data-icon="volumeOff"]').isVisible(), true);
                assert.equal(await surface.getByRole("button", { name: "Testar som", exact: true }).isDisabled(), true);
                await surface.getByRole("button", { name: "Som mudo", exact: true }).click();
                await surface.locator("#compat-volume").evaluate(input => {
                  input.value = "0"; input.dispatchEvent(new Event("input", { bubbles: true }));
                });
                assert.equal(await surface.getByRole("button", { name: "Som mudo", exact: true }).isVisible(), true);
                assert.equal(await surface.locator("#compat-volume-value").textContent(), "0%");
                assert.equal(await surface.getByRole("button", { name: "Testar som", exact: true }).isDisabled(), true);
                if (mode === "no-web-audio") assert.equal(await surface.locator("#compat-audio").getAttribute("data-audio-state"), "unsupported");
              }
              await surface.locator("#compat-theme").click();
              assert.equal(await surface.locator('#compat-theme svg[data-icon="sun"]').isVisible(), true);
              if (await surface.locator("#compat-tv").getAttribute("aria-pressed") !== "true") await surface.locator("#compat-tv").click();
              assert.equal(await surface.locator('#compat-tv svg[data-icon="tv"]').isVisible(), true);
              assert.equal(await surface.locator("#compat-volume").isVisible(), true);
            }
            if (mode !== "capability-fallback") assert.ok(requests.every(request => !new URL(request.url()).pathname.startsWith("/_next/")), mode);
            assert.ok(requests.every(request => !new URL(request.url()).pathname.startsWith("/api/") || request.method() === "GET" && new URL(request.url()).pathname.startsWith("/api/public/")), mode);
            assert.deepEqual(errors, [], mode);
            t.diagnostic(`Compatible public monitor loaded: ${mode}`);
          } finally { await context.close(); }
        }
        const snapshot = await fetch(base + "/monitor/compat?fragment=1", { headers: { Origin: "null", Authorization: "Bearer ignored-private-token" } });
        assert.equal(snapshot.status, 200); assert.equal(snapshot.headers.get("access-control-allow-origin"), "*");
        assert.equal(snapshot.headers.get("access-control-allow-credentials"), null);
        for (const path of ["/monitor?compat=1", "/monitor", "/monitor/compat?fragment=1"]) {
          const blocked = await getWithHost(base + path, "not-allowed.test", { "User-Agent": userAgent, "X-Forwarded-Host": "127.0.0.1", Origin: "null" });
          assert.equal(blocked.sentHost, "not-allowed.test", path);
          assert.equal(blocked.status, 403, path); assert.equal(blocked.headers.get("access-control-allow-origin"), null, path);
          assert.equal(JSON.parse(blocked.body).error.code, "host_not_allowed", path);
        }
        for (const sound of ["notification", "warning", "error", "success"]) {
          const audio = await fetch(base + "/monitor/compat/audio/" + sound, { headers: { Origin: "null" } });
          assert.equal(audio.status, 200, sound); assert.equal(audio.headers.get("content-type"), "audio/wav");
          assert.equal(audio.headers.get("access-control-allow-origin"), "*");
          assert.equal(Buffer.from(await audio.arrayBuffer()).toString("ascii", 0, 4), "RIFF");
        }
        assert.equal((await fetch(base + "/monitor/compat/audio/unknown")).status, 404);
        const denied = await getWithHost(base + "/monitor/compat", "not-allowed.test");
        assert.equal(denied.status, 403); assert.equal(denied.headers.get("access-control-allow-origin"), null);
        const deniedAudio = await getWithHost(base + "/monitor/compat/audio/notification", "not-allowed.test");
        assert.equal(deniedAudio.status, 403); assert.equal(deniedAudio.headers.get("access-control-allow-origin"), null);
        assert.equal((await fetch(base + "/monitor/compat", { method: "POST" })).status, 405);
      } finally { await new Promise(resolve => parent.close(resolve)); }
    });
  } finally { await browser.close(); }
});

test("compatible monitor keeps unread badges and scrolls complete panel bodies without page overflow", { timeout: 60000 }, async () => {
  const browser = await chromium.launch();
  try {
    await withServer({ PULSE_DEMO_MODE: "1", PULSE_E2E: "", PULSE_PUBLIC_HOSTS: "127.0.0.1", DATABASE_URL: "postgresql://unused:unused@127.0.0.1:1/unused", REDIS_URL: "redis://127.0.0.1:1" }, async base => {
      const page = await browser.newPage({ viewport: { width: 1280, height: 480 } });
      try {
        const fixture = JSON.parse(execFileSync(process.execPath, ["--conditions=react-server", fileURLToPath(new URL("../fixtures/monitor-compat-scroll.mjs", import.meta.url))], {
          cwd: fileURLToPath(root), windowsHide: true, encoding: "utf8", timeout: 10000, maxBuffer: 2 * 1024 * 1024,
        }));
        let unread = 4;
        await page.route(url => url.pathname.startsWith("/api/public/monitoring/notifications"), route => route.fulfill({ json: {
          counts: { unreadCount: unread, activeCount: 2 }, serverTime: new Date().toISOString(),
          runtime: { deliveryRevision: 1, enabled: false }, syncCursor: "fixture", nextCursor: "fixture", events: [], changes: [], hasMore: false,
        } }));
        // Use the real renderer with an explicit test-only presentation, leaving product defaults intact.
        await page.route(url => url.origin === base && (url.pathname === "/monitor" || url.pathname === "/monitor/compat"), async route => {
          if (new URL(route.request().url()).searchParams.get("fragment") === "1") {
            await route.fulfill({ json: { ...fixture.snapshot, state: { ...fixture.snapshot.state, serverTime: new Date().toISOString() } } });
          } else await route.fulfill({ status: 200, contentType: "text/html; charset=utf-8", body: fixture.page });
        });
        await page.goto(base + "/monitor?compat=1");
        await page.locator('#compat-viewport[data-fit-state="ready"]').waitFor();
        await page.locator("#compat-count:not([hidden])").waitFor();
        assert.equal(await page.locator("#compat-count").textContent(), "4");
        assert.equal(await page.locator("#compat-count").evaluate(element => getComputedStyle(element).backgroundColor), "rgb(220, 38, 38)");
        assert.equal(await page.locator('#compat-notifications svg[data-icon="bell"]').isVisible(), true);
        const positions = {};
        for (const type of ["asgard_summary", "signal_flow"]) {
          const selector = `.block-${type} > .dashboard-panel > .panel-content`, body = page.locator(selector);
          assert.equal(await body.count(), 1, type + ": explicit fixture must render the panel");
          assert.equal(await body.evaluate(element => element.scrollHeight > element.clientHeight + 1), true, type + ": panel must retain overflowing content");
          await body.hover(); await page.mouse.wheel(0, 250);
          await page.waitForFunction(selector => document.querySelector(selector).scrollTop > 0, selector);
          await body.focus(); await page.keyboard.press("End");
          await page.waitForFunction(selector => {
            const body = document.querySelector(selector);
            return Math.abs(body.scrollHeight - body.clientHeight - body.scrollTop) < 2;
          }, selector);
          const last = await body.locator("tbody tr").last().evaluate(element => {
            const row = element.getBoundingClientRect(), body = element.closest(".panel-content").getBoundingClientRect();
            return row.bottom <= body.bottom + 1 && row.top >= body.top - 1;
          });
          assert.equal(last, true, type + ": final row must be reachable");
          positions[selector] = await body.evaluate(element => element.scrollTop);
        }
        const refreshed = page.waitForResponse(response => new URL(response.url()).pathname === "/monitor/compat" && new URL(response.url()).searchParams.get("fragment") === "1");
        await page.locator("#compat-refresh").click(); assert.equal((await refreshed).status(), 200);
        await page.waitForFunction(() => document.getElementById("compat-content").getAttribute("data-connection") === "ready");
        for (const [selector, position] of Object.entries(positions)) assert.ok(Math.abs(await page.locator(selector).evaluate(element => element.scrollTop) - position) < 2, selector + ": refresh must preserve scroll");
        assert.equal(await page.evaluate(() => document.scrollingElement.scrollHeight <= innerHeight + 1 && document.scrollingElement.scrollWidth <= innerWidth + 1), true);
        for (const count of [0, 150]) {
          unread = count; await page.reload();
          await page.waitForFunction(count => document.getElementById("compat-notifications").getAttribute("aria-label").includes(count + " não lidas"), count);
          assert.equal(await page.locator("#compat-count").isVisible(), count > 0);
          if (count > 99) assert.equal(await page.locator("#compat-count").textContent(), "99+");
        }
      } finally { await page.close(); }
    });
  } finally { await browser.close(); }
});

test("compatible controller preserves stale evidence and completes slow screen transitions", { timeout: 90000 }, async () => {
  const browser = await chromium.launch();
  try {
    await withServer({ PULSE_DEMO_MODE: "1", PULSE_E2E: "", PULSE_PUBLIC_HOSTS: "127.0.0.1", DATABASE_URL: "postgresql://unused:unused@127.0.0.1:1/unused", REDIS_URL: "redis://127.0.0.1:1" }, async base => {
      const initial = await (await fetch(base + "/monitor/compat?fragment=1")).json();
      const fragmentUrl = url => url.pathname === "/monitor/compat" && url.searchParams.get("fragment") === "1";
      const context = await browser.newContext({ viewport: { width: 1366, height: 768 } });
      try {
        const page = await context.newPage(); let calls = 0;
        await page.route(fragmentUrl, async route => {
          calls++;
          if (calls === 2) { await route.fulfill({ status: 503, json: { error: "unavailable" } }); return; }
          if (calls === 4) { await route.fulfill({ json: { html: '<p id="invalid-marker">Resposta inválida</p>', state: {} } }); return; }
          const body = structuredClone(initial); body.state.serverTime = new Date().toISOString();
          if (calls === 1) body.html = '<p id="queued-marker">Leitura pendente</p>' + body.html;
          else {
            const until = new Date(Date.now() + 1500).toISOString();
            body.html = `<div id="expiry-reading" class="reading" data-valid-until="${until}"><strong>25%</strong><span class="metric-meter"><i style="width:25%"></i></span></div><span id="expiry-status" class="status-pill tone-good" data-live-status data-valid-until="${until}">Disponível</span>` + body.html;
          }
          await route.fulfill({ json: body });
        });
        await page.goto(base + "/monitor?compat=1");
        await page.waitForFunction(() => document.querySelector("#compat-content").getAttribute("data-monitor-controller") === "ready");
        await page.locator(".availability-card").first().click();
        await page.evaluate(() => document.getElementById("compat-refresh").click());
        await page.waitForFunction(() => document.querySelector("#compat-content").getAttribute("data-connection") === "pending");
        await page.evaluate(() => document.getElementById("compat-refresh").click());
        await page.waitForFunction(() => document.querySelector("#compat-content").getAttribute("data-connection") === "stale");
        await page.getByRole("button", { name: "Fechar", exact: true }).click();
        assert.equal(await page.locator("#queued-marker").count(), 0);
        assert.equal(await page.locator("#compat-status").isVisible(), true);
        assert.equal(await page.locator(".compat-evidence.is-stale").count(), 1);
        await page.getByRole("link", { name: "Atualizar", exact: true }).click();
        await page.waitForFunction(() => document.getElementById("expiry-status")?.getAttribute("data-expired") === "true");
        assert.equal(await page.locator("#expiry-status").textContent(), "Desatualizado");
        assert.equal(await page.locator("#expiry-reading strong").textContent(), "25%");
        assert.equal(await page.locator("#expiry-reading i").evaluate(element => element.style.width), "0%");
        await page.getByRole("link", { name: "Atualizar", exact: true }).click();
        await page.waitForFunction(() => document.querySelector("#compat-content").getAttribute("data-connection") === "stale");
        assert.equal(await page.locator("#invalid-marker").count(), 0);
        assert.equal(await page.locator("#expiry-reading strong").textContent(), "25%");
        await page.getByRole("link", { name: "Atualizar", exact: true }).click();
        await page.waitForFunction(() => document.querySelector("#compat-content").getAttribute("data-connection") === "ready");
      } finally { await context.close(); }

      const rotating = await browser.newContext({ viewport: { width: 1366, height: 768 } });
      try {
        const page = await rotating.newPage(), secondId = initial.state.screens.find(screen => screen.id !== initial.state.screenId).id;
        const second = await (await fetch(base + "/monitor/compat?fragment=1&screenId=" + secondId)).json();
        const secondBlock = /data-block-id="([^"]+)"/.exec(second.html)[1];
        await page.route(url => url.pathname === "/monitor" && url.searchParams.get("compat") === "1", async route => {
          const response = await route.fetch(), html = await response.text();
          const body = html.replace(/(<script id="compat-state" type="application\/json">)([\s\S]*?)(<\/script>)/, (_match, start, data, end) => {
            const state = JSON.parse(data); state.intervalMs = 5000; state.autoStart = false;
            return start + JSON.stringify(state).replace(/</g, "\\u003c") + end;
          });
          await route.fulfill({ response, body });
        });
        await page.route(fragmentUrl, async route => {
          const id = new URL(route.request().url()).searchParams.get("screenId");
          if (id === secondId) await delay(6000);
          const body = structuredClone(id === secondId ? second : initial);
          body.state.serverTime = new Date().toISOString(); body.state.intervalMs = 5000;
          await route.fulfill({ json: body });
        });
        await page.goto(base + "/monitor?compat=1");
        await page.getByRole("button", { name: "Alternar telas", exact: true }).click();
        await page.locator(`[data-block-id="${secondBlock}"]`).waitFor({ state: "visible", timeout: 18000 });
        assert.equal(await page.locator("#compat-screen").inputValue(), secondId);
      } finally { await rotating.close(); }
    });
  } finally { await browser.close(); }
});

test("compatible monitor fills the iframe viewport across screens and small WebViews", { timeout: 90000 }, async () => {
  const browser = await chromium.launch();
  try {
    await withServer({ PULSE_DEMO_MODE: "1", PULSE_E2E: "", PULSE_PUBLIC_HOSTS: "127.0.0.1", DATABASE_URL: "postgresql://unused:unused@127.0.0.1:1/unused", REDIS_URL: "redis://127.0.0.1:1" }, async base => {
      const parent = createHttpServer((_request, response) => {
        response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        // The frame is deliberately smaller than the display; Pulse must use its own viewport.
        response.end(`<!doctype html><style>html,body{margin:0;height:100%;overflow:hidden}iframe{position:absolute;left:17px;top:23px;width:calc(100% - 34px);height:calc(100% - 46px);border:0}</style><iframe title="Monitor ajustado" sandbox="allow-scripts" src="${base}/monitor?compat=1"></iframe>`);
      });
      await new Promise(resolve => parent.listen(0, "127.0.0.1", resolve));
      const context = await browser.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 2 });
      try {
        // The classic fallback must not require VisualViewport, which some TV engines lack.
        await context.addInitScript(() => Object.defineProperty(window, "visualViewport", { configurable: true, value: undefined }));
        const page = await context.newPage(), errors = [];
        page.on("pageerror", error => errors.push(error.message));
        await page.goto(`http://127.0.0.1:${parent.address().port}/`);
        const surface = page.frameLocator('iframe[title="Monitor ajustado"]');
        await surface.locator('#compat-viewport[data-fit-state="ready"]').waitFor();
        const frame = page.frames().find(frame => frame.url().startsWith(base + "/monitor"));
        assert.ok(frame);
        const screens = await surface.locator("#compat-screen option").evaluateAll(options => options.map(option => option.value));
        assert.ok(screens.length >= 2);
        for (const size of [{ width: 1920, height: 1080 }, { width: 1280, height: 720 }, { width: 960, height: 540 }, { width: 640, height: 360 }, { width: 1920, height: 1080 }]) {
          await page.setViewportSize(size);
          for (const screenId of screens) {
            if (await surface.locator("#compat-screen").inputValue() !== screenId) {
              const response = page.waitForResponse(response => {
                const url = new URL(response.url());
                return url.pathname === "/monitor/compat" && url.searchParams.get("fragment") === "1" && url.searchParams.get("screenId") === screenId;
              });
              await surface.locator("#compat-screen").selectOption(screenId);
              assert.equal((await response).status(), 200);
            }
            await frame.waitForFunction(() => {
              const viewport = document.getElementById("compat-viewport");
              return viewport?.getAttribute("data-fit-state") === "ready" && Number(viewport.getAttribute("data-fit-width")) === window.innerWidth && Number(viewport.getAttribute("data-fit-height")) === window.innerHeight && document.getElementById("compat-content").getAttribute("data-connection") !== "updating";
            });
            const geometry = await frame.evaluate(() => {
              const bounds = element => { const rect = element.getBoundingClientRect(); return { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom, height: rect.height }; };
              const rows = [...document.querySelectorAll(".compat-row")];
              return {
                width: window.innerWidth, height: window.innerHeight,
                scrollWidth: document.scrollingElement.scrollWidth, scrollHeight: document.scrollingElement.scrollHeight,
                footer: bounds(document.querySelector(".dashboard-footer")),
                panels: [...document.querySelectorAll(".compat-cell > .dashboard-panel")].map(bounds),
                rows: rows.map(bounds), flexible: rows.some(row => !row.classList.contains("content-sized")),
                scale: Number(document.getElementById("compat-viewport").getAttribute("data-fit-scale")),
              };
            });
            const label = `${size.width}x${size.height} / ${screenId}`;
            assert.ok(geometry.scrollWidth <= geometry.width + 1 && geometry.scrollHeight <= geometry.height + 1, label + ": document overflow");
            assert.ok(geometry.footer.bottom <= geometry.height + 1 && geometry.footer.bottom >= geometry.height - 24, label + ": footer outside viewport or unused height");
            for (const panel of geometry.panels) {
              assert.ok(panel.height > 0 && panel.left >= -1 && panel.right <= geometry.width + 1 && panel.bottom <= geometry.footer.top + 1, label + ": clipped panel");
            }
            for (let index = 1; index < geometry.rows.length; index++) assert.ok(geometry.rows[index].top >= geometry.rows[index - 1].bottom - 1, label + ": overlapping rows");
            if (geometry.flexible) assert.ok(Math.abs(geometry.rows.at(-1).bottom - geometry.footer.top) <= 3, label + ": unused panel area");
            if (size.width <= 960) assert.ok(geometry.scale < 1, label + ": small viewport needs automatic scale");
          }
        }
        await frame.evaluate(() => { window.__pulseNativeRect = Element.prototype.getBoundingClientRect; });
        for (const legacy of [false, true]) {
          if (legacy) await frame.evaluate(() => {
            // Emulate the CSS-zoom rectangle convention used by old Chromium, without
            // changing how this browser actually renders. Native rectangles remain the oracle.
            function effectiveCssZoom(element) {
              let zoom = 1;
              for (let node = element; node instanceof Element; node = node.parentElement) {
                const raw = getComputedStyle(node).zoom;
                let value = parseFloat(raw); if (String(raw).includes("%")) value /= 100;
                if (Number.isFinite(value) && value > 0) zoom *= value;
              }
              return zoom;
            }
            Element.prototype.getBoundingClientRect = function () {
              const zoom = effectiveCssZoom(this);
              const rect = window.__pulseNativeRect.call(this);
              return new DOMRect(rect.x / zoom, rect.y / zoom, rect.width / zoom, rect.height / zoom);
            };
          });
          const baseline = await frame.evaluate(() => ({ width: document.getElementById("compat-shell").offsetWidth, textHeight: window.__pulseNativeRect.call(document.querySelector(".panel-heading h2")).height }));
          // CSS zoom does not have to fire resize. It must change density, not leave a smaller canvas.
          for (const target of ["body", "root", "shell"]) {
            for (const zoom of [0.7, 1.25, 1]) {
              await frame.evaluate(({ target, zoom }) => {
                document.body.style.zoom = "1"; document.documentElement.style.zoom = "1"; document.getElementById("compat-shell").style.zoom = "1";
                const element = target === "body" ? document.body : target === "root" ? document.documentElement : document.getElementById("compat-shell");
                element.style.zoom = String(zoom);
              }, { target, zoom });
              await frame.waitForFunction(zoom => {
                const viewport = document.getElementById("compat-viewport"), shell = document.getElementById("compat-shell");
                const rect = window.__pulseNativeRect.call(shell);
                return Math.abs(Number(viewport.getAttribute("data-fit-zoom-x")) - zoom) < 0.01 && Math.abs(rect.width - window.innerWidth) < 2 && Math.abs(rect.height - window.innerHeight) < 2;
              }, zoom);
              const result = await frame.evaluate(() => {
                const shell = document.getElementById("compat-shell"), rect = window.__pulseNativeRect.call(shell), footer = window.__pulseNativeRect.call(document.querySelector(".dashboard-footer"));
                return { width: rect.width, height: rect.height, left: rect.left, top: rect.top, viewportWidth: window.innerWidth, viewportHeight: window.innerHeight, logicalWidth: shell.offsetWidth, textHeight: window.__pulseNativeRect.call(document.querySelector(".panel-heading h2")).height, footerBottom: footer.bottom };
              });
              const label = `${legacy ? "legacy" : "native"} ${target} zoom ${zoom}`;
              assert.equal(await surface.locator("#compat-viewport").getAttribute("data-fit-rect-mode"), legacy ? "legacy" : "viewport", label);
              assert.ok(Math.abs(result.left) < 2 && Math.abs(result.top) < 2, label + ": shifted canvas");
              assert.ok(Math.abs(result.width - result.viewportWidth) < 2 && Math.abs(result.height - result.viewportHeight) < 2, label + ": empty screen margins");
              assert.ok(result.footerBottom <= result.viewportHeight + 1 && result.footerBottom >= result.viewportHeight - 24, label + ": footer not fitted");
              if (zoom === 0.7) {
                assert.ok(result.logicalWidth > baseline.width * 1.1, label + ": zoom out must expose more logical space");
                assert.ok(result.textHeight < baseline.textHeight * 0.9, label + ": zoom out must keep text smaller");
              }
              // Replacing a screen must retain the requested zoom and fill the same viewport.
              const current = await surface.locator("#compat-screen").inputValue(), next = screens.find(id => id !== current);
              const response = page.waitForResponse(response => new URL(response.url()).searchParams.get("screenId") === next);
              await surface.locator("#compat-screen").selectOption(next); assert.equal((await response).status(), 200);
              await frame.waitForFunction(() => document.getElementById("compat-content").getAttribute("data-connection") === "ready");
              assert.equal(await frame.evaluate(() => document.getElementById("compat-shell").style.zoom), target === "shell" ? String(zoom) : "1");
            }
          }
        }
        await frame.evaluate(() => { Element.prototype.getBoundingClientRect = window.__pulseNativeRect; });
        // Simulate a WebView exposing a larger visual viewport after zooming out, without resize.
        await frame.evaluate(() => Object.defineProperty(window, "visualViewport", { configurable: true, value: { width: window.innerWidth / 0.7, height: window.innerHeight / 0.7, offsetLeft: 0, offsetTop: 0, scale: 0.7 } }));
        await frame.waitForFunction(() => Math.abs(Number(document.getElementById("compat-viewport").getAttribute("data-fit-width")) - window.innerWidth / 0.7) < 1);
        assert.ok(await frame.evaluate(() => document.getElementById("compat-shell").getBoundingClientRect().width > window.innerWidth * 1.1));
        await frame.evaluate(() => Object.defineProperty(window, "visualViewport", { configurable: true, value: undefined }));
        await frame.waitForFunction(() => Math.abs(document.getElementById("compat-shell").getBoundingClientRect().width - window.innerWidth) < 2);
        assert.deepEqual(errors, []);
      } finally { await context.close(); await new Promise(resolve => parent.close(resolve)); }
    });
  } finally { await browser.close(); }
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
      await page.getByRole("heading", { name: "Toda a operação. Um só lugar." }).waitFor();
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
    await cache.connect();
    assert.equal(await cache.dbSize(), 0, "Redis DB 14 must be empty for read-only runtime tests");
    const hostsKey = "pulse:inventory:hosts", syncKey = "pulse:sync:last";
    try {
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
      const observedAt = new Date().toISOString(), generation = randomUUID();
      const runtimeHost = {
        hostKey: "runtime-host", name: "runtime-host", role: "unknown", availability: "reachable",
        metrics: { cpuUsagePercent: { value: 1, unit: "percent", observedAt, quality: "fresh" } },
        storages: [], filesystems: [], interfaces: [], vms: [],
        evidence: { source: "zabbix", observedAt, basis: "item" },
      };
      const wrap = data => JSON.stringify({ data, updatedAt: observedAt, source: "zabbix", generation });
      await cache.set(hostsKey, wrap([runtimeHost]), { EX: 120 });
      await cache.set(syncKey, wrap({ status: "ok", lastSuccessfulAt: observedAt, lastAttemptAt: observedAt, error: null, keys: [hostsKey] }), { EX: 120 });
      const post = await fetch(base + "/api/monitoring/services", { method: "POST", headers: auth, body: JSON.stringify({ resourceType: "host", zabbixHostKey: "runtime-host", displayName: "Runtime" }) });
      assert.equal(post.status, 201); resourceId = (await post.json()).data.id;
      const edit = await fetch(base + "/api/monitoring/services/" + resourceId, { method: "PATCH", headers: auth, body: JSON.stringify({ displayName: "Persistido" }) }); assert.equal(edit.status, 200);
      // Drop discovery so protected reads stay on the empty/no_data contract for this suite.
      await cache.del([hostsKey, syncKey]);
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
      if (cache.isOpen) { await cache.del([hostsKey, syncKey]).catch(() => {}); await cache.quit(); }
    }
  } finally {
    await upstream.close();
    assert.match(dbName, /^pulse_runtime03_test_\d+_\d+$/);
    if (created) await admin.query('DROP DATABASE "' + dbName + '" WITH (FORCE)');
    await admin.end();
  }
});
