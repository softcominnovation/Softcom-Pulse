import test, { before } from "node:test";
import assert from "node:assert/strict";
import { cp, mkdir } from "node:fs/promises";
import { spawn, execFileSync } from "node:child_process";
import { createServer, get as httpGet } from "node:http";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";

const root = new URL("../../", import.meta.url), standalone = new URL(".next/standalone/", root);
process.env.PLAYWRIGHT_BROWSERS_PATH ??= fileURLToPath(new URL(".cache/ms-playwright", root));
const { chromium } = await import("@playwright/test");
before(async () => {
  await cp(new URL("public/", root), new URL("public/", standalone), { recursive: true });
  await cp(new URL(".next/static/", root), new URL(".next/static/", standalone), { recursive: true });
  await mkdir(new URL(".cache/screenshots/", root), { recursive: true });
});
async function listen(server) {
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  return `http://127.0.0.1:${server.address().port}`;
}
async function shipped(run) {
  const portServer = createServer(), address = await listen(portServer), port = new URL(address).port;
  await new Promise(resolve => portServer.close(resolve));
  const child = spawn(process.execPath, [fileURLToPath(new URL("server.js", standalone))], {
    cwd: fileURLToPath(standalone), windowsHide: true, stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, NODE_ENV: "production", PORT: port, HOSTNAME: "127.0.0.1", PULSE_DEMO_MODE: "1", PULSE_E2E: "", PULSE_PUBLIC_HOSTS: "127.0.0.1", DATABASE_URL: "postgresql://unused:unused@127.0.0.1:1/unused", REDIS_URL: "redis://127.0.0.1:1" },
  });
  let output = "";
  child.stdout.on("data", chunk => { output = (output + chunk).slice(-8000); });
  child.stderr.on("data", chunk => { output = (output + chunk).slice(-8000); });
  const exited = new Promise(resolve => child.once("exit", resolve));
  try {
    let ready = false;
    for (let count = 0; count < 150 && child.exitCode === null; count++) {
      if (await fetch(address + "/monitor/compat").then(response => response.ok).catch(() => false)) { ready = true; break; }
      await delay(100);
    }
    assert.ok(ready, "Standalone did not become ready: " + output);
    await run(address);
  } finally { child.kill(); await Promise.race([exited, delay(3000)]); }
}
function getWithHost(address, host, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = httpGet(address, { headers: { Host: host, ...headers } }, response => {
      let body = ""; response.on("data", chunk => { body += chunk; });
      response.on("end", () => resolve({ status: response.statusCode, headers: response.headers, body }));
    });
    req.on("error", reject);
  });
}
const oldUa = "Mozilla/5.0 (Linux; Android 11; TV) AppleWebKit/537.36 Version/4.0 Chrome/83.0.4103.120 Safari/537.36";

test("shipped classic monitor preserves Host behind an HTTPS tunnel and serves anonymous opaque frames", { timeout: 90000 }, async () => {
  await shipped(async base => {
    for (const path of ["/monitor", "/monitor?compat=1"]) {
      const response = await fetch(base + path, { headers: { "User-Agent": oldUa, "X-Forwarded-Proto": "https", "X-Forwarded-Port": "443", "X-Forwarded-Host": "untrusted.test" } });
      assert.equal(response.status, 200, path);
      const html = await response.text(); assert.match(html, /id="compat-shell"/); assert.doesNotMatch(html, /\/_next\//);
      const denied = await getWithHost(base + path, "untrusted.test", { "User-Agent": oldUa, "X-Forwarded-Host": "127.0.0.1", "X-Forwarded-Proto": "https" });
      assert.equal(denied.status, 403); assert.equal(denied.headers["access-control-allow-origin"], undefined);
    }
    const parent = createServer((_request, response) => {
      response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      response.end(`<!doctype html><iframe title="Monitor clássico" sandbox="allow-scripts" src="${base}/monitor" width="1280" height="720"></iframe>`);
    });
    const parentAddress = await listen(parent), browser = await chromium.launch();
    try {
      for (const mode of ["classic", "iframe-modern", "no-js", "no-audio", "blocked-audio"]) {
        const noJs = mode === "no-js";
        const context = await browser.newContext({ viewport: { width: 1366, height: 768 }, javaScriptEnabled: !noJs, ...(mode === "iframe-modern" ? {} : { userAgent: oldUa }) });
        try {
          if (mode === "no-audio") await context.addInitScript(() => { window.AudioContext = undefined; window.webkitAudioContext = undefined; });
          const page = await context.newPage(), errors = [], nextBundles = [];
          if (mode === "blocked-audio") await page.route("**/monitor-compat-audio.js*", route => route.abort());
          page.on("pageerror", error => errors.push(error.message));
          page.on("request", request => { if (new URL(request.url()).pathname.startsWith("/_next/")) nextBundles.push(request.url()); });
          await page.goto(parentAddress);
          const frame = page.frameLocator('iframe[title="Monitor clássico"]');
          await frame.locator("#compat-content .dashboard-blocks").waitFor({ state: "visible" });
          assert.ok(await frame.locator('svg[data-icon="server"]').count());
          assert.equal(await frame.locator("#compat-sound-settings").isVisible(), true);
          assert.equal(await frame.locator(".pulse-topbar input[type=range]").count(), 0);
          if (!noJs) {
            await frame.locator('#compat-content[data-monitor-controller="ready"]').waitFor();
            const update = page.waitForResponse(response => new URL(response.url()).pathname === "/monitor/compat" && new URL(response.url()).searchParams.has("fragment"));
            await frame.locator("#compat-refresh").click();
            const response = await update; assert.equal(response.status(), 200); assert.equal((await response.request().allHeaders()).origin, "null");
            assert.equal(response.headers()["access-control-allow-origin"], "*");
            if (mode === "no-audio" || mode === "blocked-audio") {
              await frame.locator(`#compat-audio[data-audio-state="${mode === "no-audio" ? "unsupported" : "unavailable"}"]`).waitFor();
              if (mode === 'no-audio') {
                await frame.locator('#compat-sound-settings').click();
                assert.equal(await frame.locator('#compat-test-sound').isEnabled(), false);
              } else assert.equal(await frame.locator('#compat-sound-settings').isEnabled(), false);
            }
          }
          assert.deepEqual(errors, []); assert.deepEqual(nextBundles, []);
        } catch (error) {
          const page = context.pages()[0];
          if (page) await page.screenshot({ path: fileURLToPath(new URL(".cache/screenshots/monitor-compat-frame-failure.png", root)), fullPage: true });
          throw error;
        } finally { await context.close(); }
      }
    } finally { await browser.close(); await new Promise(resolve => parent.close(resolve)); }
    for (const path of ["/monitor/compat/notifications", "/monitor/compat/audio/notification"]) {
      assert.equal((await getWithHost(base + path, "untrusted.test")).status, 403);
      assert.equal((await fetch(base + path, { method: "POST" })).status, 405);
    }
  });
});

test("current classic cards fill native layout, scroll complete bodies and keep usage/history/audio controls", { timeout: 90000 }, async () => {
  const fixture = JSON.parse(execFileSync(process.execPath, ["--conditions=react-server", "tests/fixtures/monitor-compat.mjs"], { cwd: fileURLToPath(root), encoding: "utf8" }));
  await shipped(async base => {
    const browser = await chromium.launch(), context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
    try {
      await context.addInitScript(() => {
        for (const name of ["localStorage", "sessionStorage"]) Object.defineProperty(window, name, { get() { throw new DOMException("blocked", "SecurityError"); } });
      });
      const page = await context.newPage(), errors = [], notificationRequests = [];
      let unreadCount = 4;
      page.on("pageerror", error => errors.push(error.message));
      await page.route("**/monitor?compat=1", route => route.fulfill({ contentType: "text/html", body: fixture.page }));
      await page.route("**/monitor/compat?fragment=1*", route => route.fulfill({ json: fixture.snapshot }));
      await page.route("**/monitor/compat/notifications**", route => {
        notificationRequests.push(route.request().url());
        const counts = { unreadCount, activeCount: 1 }, runtime = { enabled: false, deliveryRevision: "1" }, serverTime = new Date().toISOString();
        const entry = { id: "00000000-0000-4000-8000-000000000044", incidentId: "00000000-0000-4000-8000-000000000045", displayName: "Storage configurado", message: "Disco do Storage em 72,5% · limite 70%", createdAt: serverTime, readAt: unreadCount === 0 ? serverTime : null };
        const path = new URL(route.request().url()).pathname;
        if (path.endsWith("/changes")) return route.fulfill({ json: { changes: [], nextCursor: "test", hasMore: false, counts, runtime, serverTime } });
        const incident = { ...entry, id: entry.incidentId, status: "active", metricContext: { coverage: "Volumes selecionados" } };
        return route.fulfill({ json: { counts, events: [entry], incidents: [incident], ...(path.includes("/incidents/") ? { incident } : {}), syncCursor: "test", nextPageCursor: null, serverTime, runtime } });
      });
      await page.goto(base + "/monitor?compat=1");
      await page.locator('#compat-content[data-monitor-controller="ready"]').waitFor();
      await page.getByRole("button", { name: "Notificações: 4 não lidas, 1 incidentes atuais" }).waitFor();
      assert.equal(await page.locator("#compat-count").evaluate(element => getComputedStyle(element).backgroundColor), "rgb(220, 38, 38)");
      for (const [width, height] of [[1280, 720], [1920, 1080], [960, 540]]) {
        await page.setViewportSize({ width, height });
        const geometry = await page.locator("#compat-shell").evaluate(shell => ({ width: shell.getBoundingClientRect().width, height: shell.getBoundingClientRect().height, innerWidth, innerHeight, scrollWidth: document.documentElement.scrollWidth, scrollHeight: document.documentElement.scrollHeight, transform: getComputedStyle(shell).transform }));
        assert.ok(Math.abs(geometry.width - geometry.innerWidth) < 2 && Math.abs(geometry.height - geometry.innerHeight) < 2, JSON.stringify(geometry));
        assert.ok(geometry.scrollWidth <= width + 2 && geometry.scrollHeight <= height + 2, JSON.stringify(geometry));
        assert.equal(geometry.transform, "none");
        const availability = await page.locator(".block-highlighted_resources > .dashboard-panel").evaluate(panel => ({ height: panel.getBoundingClientRect().height, body: panel.querySelector('.panel-content').clientHeight }));
        assert.ok(availability.height >= 180 && availability.body >= 110, JSON.stringify(availability));
      }
      await page.setViewportSize({ width: 1280, height: 720 });
      for (const zoom of [70, 50, 125, 100]) {
        await page.evaluate(value => { document.documentElement.style.zoom = value + '%'; }, zoom);
        await page.waitForFunction(value => {
          const viewport = document.getElementById('compat-viewport');
          return value === 100 ? viewport.style.width === '' : Math.abs(parseFloat(viewport.style.width) * value / 100 - innerWidth) < 1;
        }, zoom);
        const bounds = await page.locator('#compat-shell').evaluate(shell => ({
          width: shell.getBoundingClientRect().width, height: shell.getBoundingClientRect().height,
          header: shell.querySelector('.pulse-topbar').getBoundingClientRect().width,
          footer: shell.querySelector('.dashboard-footer').getBoundingClientRect().bottom,
          scrollWidth: document.documentElement.scrollWidth, scrollHeight: document.documentElement.scrollHeight,
          transform: getComputedStyle(shell).transform,
        }));
        assert.ok(Math.abs(bounds.width - 1280) < 2 && Math.abs(bounds.height - 720) < 2, JSON.stringify({ zoom, bounds }));
        assert.ok(Math.abs(bounds.header - 1280) < 2 && bounds.footer > 690 && bounds.footer <= 721, JSON.stringify({ zoom, bounds }));
        assert.ok(bounds.scrollWidth <= 1282 && bounds.scrollHeight <= 722, JSON.stringify({ zoom, bounds }));
        assert.equal(bounds.transform, 'none');
        if (zoom === 70) {
          await page.locator('#compat-notifications').click();
          const modalBounds = await page.locator('#compat-modal').evaluate(element => ({ width: element.getBoundingClientRect().width, height: element.getBoundingClientRect().height }));
          assert.ok(Math.abs(modalBounds.width - 1280) < 2 && Math.abs(modalBounds.height - 720) < 2, JSON.stringify(modalBounds));
          await page.getByRole('button', { name: 'Fechar', exact: true }).click();
        }
      }
      for (const type of ["asgard_summary", "signal_flow", "storage_summary"]) {
        const region = page.locator(`.block-${type} > .dashboard-panel > .panel-content`);
        const before = await region.evaluate(element => ({ client: element.clientHeight, scroll: element.scrollHeight, overflow: getComputedStyle(element).overflowY }));
        assert.equal(before.overflow, "auto"); assert.ok(before.client > 0);
        if (before.scroll > before.client + 2) {
          await region.click(); await region.press("End");
          await page.waitForFunction(selector => { const element = document.querySelector(selector); return element.scrollTop >= element.scrollHeight - element.clientHeight - 2; }, `.block-${type} > .dashboard-panel > .panel-content`, { timeout: 3000 });
          assert.ok(await region.evaluate(element => element.scrollTop > 0), type);
        }
      }
      const positions = await page.locator('.compat-cell > .dashboard-panel > .panel-content').evaluateAll(elements => elements.map(element => element.scrollTop));
      const refreshed = page.waitForResponse(response => new URL(response.url()).pathname === '/monitor/compat' && new URL(response.url()).searchParams.has('fragment'));
      await page.locator('#compat-refresh').click(); await refreshed;
      await page.locator('#compat-content[data-connection="ready"]').waitFor();
      assert.deepEqual(await page.locator('.compat-cell > .dashboard-panel > .panel-content').evaluateAll(elements => elements.map(element => element.scrollTop)), positions);
      await page.locator("#compat-notifications").click();
      await page.getByText("Disco do Storage em 72,5% · limite 70%", { exact: true }).waitFor();
      await page.getByRole("button", { name: "Ver incidente", exact: true }).click();
      await page.getByText("Valor histórico · Volumes selecionados", { exact: true }).waitFor();
      await page.getByRole("button", { name: "Fechar", exact: true }).click();
      await page.locator("#compat-notifications").click();
      await page.getByRole("button", { name: "Histórico", exact: true }).click();
      await page.locator("#compat-history-from").waitFor({ state: "visible" });
      const from = await page.locator("#compat-history-from").inputValue();
      assert.ok(from); assert.equal(await page.locator("#compat-history-from").getAttribute("max"), from);
      assert.ok(notificationRequests.some(url => url.includes("/history?") && url.includes("from=" + from)));
      unreadCount = 0;
      await page.getByRole("button", { name: "Aplicar filtros", exact: true }).click();
      await page.locator("#compat-count").waitFor({ state: "hidden" });
      unreadCount = 150;
      await page.getByRole("button", { name: "Aplicar filtros", exact: true }).click();
      await page.locator("#compat-count").filter({ hasText: "99+" }).waitFor({ state: "visible" });
      await page.getByRole("button", { name: "Fechar", exact: true }).click();
      assert.equal(await page.locator("body").evaluate(body => body.style.overflow), "");
      await page.getByRole("button", { name: "Som ativo", exact: true }).click();
      await page.getByRole("button", { name: "Ajustar sons", exact: true }).click();
      assert.equal(await page.getByRole("button", { name: "Testar som", exact: true }).isEnabled(), false);
      await page.locator('#compat-volume').press('Home');
      await page.getByRole('button', { name: 'Fechar', exact: true }).click();
      await page.getByRole('button', { name: 'Ajustar sons', exact: true }).click();
      assert.equal(await page.locator('#compat-volume').inputValue(), '0');
      assert.equal(await page.getByRole('button', { name: 'Testar som', exact: true }).isEnabled(), false);
      assert.deepEqual(errors, []);
      await page.screenshot({ path: fileURLToPath(new URL(".cache/screenshots/monitor-compat-current.png", root)), fullPage: true });
    } finally { await context.close(); await browser.close(); }
  });
});


test("configured classic zoom fills the first render without JS and updates without TV amplification", { timeout: 60000 }, async () => {
  const fixture = JSON.parse(execFileSync(process.execPath, ['--conditions=react-server', 'tests/fixtures/monitor-compat.mjs', '70'], { cwd: fileURLToPath(root), encoding: 'utf8' }));
  await shipped(async base => {
    const browser = await chromium.launch();
    try {
      for (const javaScriptEnabled of [false, true]) {
        const context = await browser.newContext({ viewport: { width: 1280, height: 720 }, javaScriptEnabled });
        try {
          const page = await context.newPage();
          await page.route('**/monitor?compat=1', route => route.fulfill({ contentType: 'text/html', body: fixture.page }));
          await page.route('**/monitor/compat?fragment=1*', route => route.fulfill({ json: { ...fixture.snapshot, state: { ...fixture.snapshot.state, zoomPercent: 125 } } }));
          await page.goto(base + '/monitor?compat=1');
          const initial = await page.locator('#compat-shell').boundingBox();
          assert.ok(Math.abs(initial.width - 1280) < 2 && Math.abs(initial.height - 720) < 2, JSON.stringify({ javaScriptEnabled, initial }));
          assert.equal(await page.locator('html').evaluate(element => element.style.zoom), '70%');
          if (javaScriptEnabled) {
            await page.locator('#compat-content[data-monitor-controller=ready]').waitFor();
            assert.equal(await page.locator('.panel-heading h2').first().evaluate(e => getComputedStyle(e).fontSize), '13px');
            await page.locator('#compat-refresh').click();
            await page.waitForFunction(() => document.documentElement.style.zoom === '125%');
            const updated = await page.locator('#compat-shell').boundingBox();
            assert.ok(Math.abs(updated.width - 1280) < 2 && Math.abs(updated.height - 720) < 2, JSON.stringify(updated));
            await page.evaluate(() => {
              const supports = CSS.supports.bind(CSS);
              CSS.supports = (property, value) => property === 'zoom' ? false : supports(property, value);
              const style = document.createElement('style'); style.textContent = 'html{zoom:1!important}'; document.head.appendChild(style);
              document.documentElement.style.zoom = '70%';
            });
            await page.waitForFunction(() => document.getElementById('compat-viewport').style.transform === 'scale(0.7)');
            const fallback = await page.locator('#compat-shell').boundingBox();
            assert.ok(Math.abs(fallback.width - 1280) < 2 && Math.abs(fallback.height - 720) < 2, JSON.stringify(fallback));
          }
        } finally { await context.close(); }
      }
    } finally { await browser.close(); }
  });
});

test("modern monitor uses its own zoom, keeps TV scale neutral and leaves the private root unchanged", { timeout: 60000 }, async () => {
  await shipped(async base => {
    const browser = await chromium.launch(), context = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
    try {
      const page = await context.newPage(), configuration = await fetch(base + '/api/public/settings/presentation').then(r => r.json());
      configuration.data.displayScalePercent = 125;
      configuration.data.publicMonitorZoomPercent = 70;
      await page.route('**/api/public/settings/presentation', route => route.fulfill({ json: configuration }));
      await page.goto(base + '/monitor?compat=0');
      await page.locator('[data-public-monitor-zoom="70"]').waitFor();
      await page.getByRole('heading', { name: 'Disponibilidade de Serviços', exact: true }).waitFor();
      const bounds = await page.locator('.public-monitor-stage').evaluate(element => ({ width: element.getBoundingClientRect().width, height: element.getBoundingClientRect().height, scale: element.querySelector('.dashboard-shell').getAttribute('data-display-scale'), footer: element.querySelector('.dashboard-footer').getBoundingClientRect().bottom }));
      assert.ok(Math.abs(bounds.width - 1920) < 2 && Math.abs(bounds.height - 1080) < 2, JSON.stringify(bounds));
      assert.equal(bounds.scale, '100');
      for (const zoom of [50, 100, 125, 150, 70]) {
        configuration.data.publicMonitorZoomPercent = zoom;
        await page.reload();
        await page.locator(`[data-public-monitor-zoom="${zoom}"]`).waitFor();
        await page.getByRole('heading', { name: 'Disponibilidade de Serviços', exact: true }).waitFor();
        const current = await page.locator('.public-monitor-stage').boundingBox();
        assert.ok(Math.abs(current.width - 1920) < 2 && Math.abs(current.height - 1080) < 2, JSON.stringify({ zoom, current }));
        assert.equal(await page.locator('.dashboard-shell').getAttribute('data-display-scale'), '100');
      }
      await page.screenshot({ path: fileURLToPath(new URL('.cache/screenshots/monitor-02-modern.png', root)) });
      await page.setViewportSize({ width: 1280, height: 720 });
      const compact = await page.locator('.public-monitor-stage').evaluate(element => ({ width: element.getBoundingClientRect().width, height: element.getBoundingClientRect().height, footer: element.querySelector('.dashboard-footer').getBoundingClientRect().bottom }));
      assert.ok(Math.abs(compact.width - 1280) < 2 && Math.abs(compact.height - 720) < 2 && compact.footer > 690 && compact.footer <= 721, JSON.stringify(compact));
      const response = await page.request.get(base + '/monitor?compat=0');
      assert.match(await response.text(), /data-public-monitor-zoom="100"/);
      assert.equal(await page.locator('html').evaluate(e => e.style.zoom), '');
      await page.goto(base + '/');
      assert.equal(await page.locator('.public-monitor-frame').count(), 0);
    } finally { await context.close(); await browser.close(); }
  });
});
