import test, { before } from "node:test";
import assert from "node:assert/strict";
import { cp, mkdir } from "node:fs/promises";
import { spawn, execFileSync } from "node:child_process";
import { createServer, get as httpGet } from "node:http";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";

const root = new URL("../../", import.meta.url), standalone = new URL(".next/standalone/", root);
process.env.PLAYWRIGHT_BROWSERS_PATH ??= fileURLToPath(new URL(".cache/ms-playwright", root));
const { chromium, expect } = await import("@playwright/test");
before(async () => {
  await cp(new URL("public/", root), new URL("public/", standalone), { recursive: true });
  await cp(new URL(".next/static/", root), new URL(".next/static/", standalone), { recursive: true });
  await mkdir(new URL(".cache/screenshots/", root), { recursive: true });
});

test("classic notification arrivals match Kobra tones and WAVs without using the volume test", { timeout: 120000 }, async () => {
  await shipped(async base => {
    const parent = createServer((_request, response) => {
      response.setHeader('Content-Type', 'text/html');
      response.end(`<style>body{margin:0}iframe{width:1280px;height:720px;border:0}</style><iframe title="Monitor" sandbox="allow-scripts" src="${base}/monitor?compat=1"></iframe>`);
    });
    const parentAddress = await listen(parent), browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
    const context = await browser.newContext({ viewport: { width: 1366, height: 768 } });
    try {
      await context.addInitScript(() => {
        window.notificationVoices = [];
        const start = AudioBufferSourceNode.prototype.start, connect = AudioBufferSourceNode.prototype.connect;
        AudioBufferSourceNode.prototype.connect = function (node, ...ports) { this.notificationGain = node; return connect.call(this, node, ...ports); };
        AudioBufferSourceNode.prototype.start = function (...args) {
          if (this.buffer) {
            const samples = this.buffer.getChannelData(0); let signature = 0;
            for (let i = 0; i < samples.length; i++) signature += samples[i] * (i % 31 + 1);
            window.notificationVoices.push({ signature, gain: this.notificationGain.gain.value });
          }
          return start.apply(this, args);
        };
      });
      const page = await context.newPage(), normal = await context.newPage(), errors = [];
      await page.clock.install();
      await normal.clock.install();
      await normal.goto(base + '/monitor?compat=0');
      await normal.locator('.dashboard-shell').waitFor();
      let revision = 1, polls = 0; const changes = [];
      const runtime = { enabled: true, deliveryRevision: '1', policyRevision: 1, toastPosition: 'header-center', toastLifetimeMs: 8000, soundCooldownMs: 15000, maxDeliveryAgeMs: 60000, visualGapMs: 10000 };
      await page.route('**/monitor/compat/notifications**', route => {
        const url = new URL(route.request().url()); polls++;
        const common = { counts: { unreadCount: revision - 1, activeCount: 1 }, serverTime: new Date().toISOString(), runtime };
        return route.fulfill({ headers: { 'Access-Control-Allow-Origin': '*' }, json: url.pathname.endsWith('/changes') ? { ...common, changes: changes.filter(change => Number(change.revision) > Number(url.searchParams.get('after'))), nextCursor: String(revision), streamRevision: String(revision), hasMore: false } : { ...common, events: [], incidents: [], syncCursor: String(revision), streamRevision: String(revision) } });
      });
      page.on('pageerror', error => errors.push(error.message));
      await page.goto(parentAddress); await page.bringToFront();
      const frame = page.frameLocator('iframe'), toast = frame.locator('#compat-toast');
      await frame.locator('#compat-audio[data-audio-state="ready"]').waitFor();
      await expect.poll(() => polls).toBeGreaterThan(0);
      const expected = await frame.locator('html').evaluate(async () => {
        const audio = new AudioContext(), result = {};
        for (const name of ['error', 'warning', 'success', 'notification']) {
          const bytes = await fetch('/monitor/compat/audio/' + name).then(response => response.arrayBuffer());
          const buffer = await audio.decodeAudioData(bytes), samples = buffer.getChannelData(0); let signature = 0;
          for (let i = 0; i < samples.length; i++) signature += samples[i] * (i % 31 + 1);
          result[name] = signature;
        }
        await audio.close(); return result;
      });
      const tones = [ ['error', 'unavailable', 'critical', 'error'], ['warning', 'attention', 'warning', 'warning'], ['success', 'recovery', 'info', 'success'], ['info', 'attention', 'info', 'notification'] ];
      for (const [tone, eventType, severity, sound] of tones) {
        const event = { id: 'event-' + (++revision), incidentId: 'incident-' + revision, targetRef: 'storage:fixture', displayName: 'Storage de operações', message: eventType === 'recovery' ? 'Serviço recuperado' : 'Serviço indisponível', eventType, severity, announce: true, toastEligible: true, readAt: null, incidentStatus: eventType === 'recovery' ? 'resolved' : 'active', sound, createdAt: new Date().toISOString() };
        changes.push({ revision: String(revision), kind: 'incident', payload: { event } });
        const previousPolls = polls;
        await page.clock.fastForward(16000);
        await expect.poll(() => polls).toBeGreaterThan(previousPolls);
        await expect.poll(() => frame.locator('html').evaluate(() => window.notificationVoices.length)).toBe(tones.findIndex(item => item[0] === tone) + 1);
        const voice = await frame.locator('html').evaluate(() => window.notificationVoices.at(-1));
        assert.ok(Math.abs(voice.signature - expected[sound]) < .0001, sound + ' uses the same WAV');
        assert.ok(Math.abs(voice.gain - .5 * (severity === 'critical' ? .65 : .45)) < .0001);
        await page.clock.runFor(2500);
        await expect(toast).toBeVisible(); await expect(toast).toHaveAttribute('data-tone', tone);
        assert.equal(await toast.evaluate(element => getComputedStyle(element).top), '16px', 'Header-center toast keeps its inset in the compatible monitor');
        assert.equal(await toast.locator('#compat-toast-title').innerText(), event.displayName);
        assert.equal(await toast.locator('#compat-toast-detail').innerText(), event.message);
        assert.equal(await toast.locator(`[data-toast-glyph="${tone}"] svg`).isVisible(), true);
        for (const theme of ['dark', 'light']) {
          await frame.locator('html').evaluate((html, theme) => { html.className = theme; }, theme);
          await normal.locator('html').evaluate((html, theme) => { html.className = theme; }, theme);
          await normal.evaluate(({ tone, event }) => window.dispatchEvent(new CustomEvent('kobra:toast', { detail: { id: 'parity', operational: true, state: tone, message: event.displayName + ' · ' + event.message, sound: false, lifetime: 15000, action: { label: 'Ver central', run() {} } } })), { tone, event });
          const modern = normal.locator('[data-operational-toast="parity"]');
          await expect(modern).toBeVisible();
          await normal.clock.runFor(1000);
          await page.clock.runFor(400);
          const read = element => {
            const s = getComputedStyle(element), canvas = document.createElement('canvas'), ctx = canvas.getContext('2d');
            canvas.width = canvas.height = 1;
            const color = value => { ctx.clearRect(0,0,1,1); ctx.fillStyle = value; ctx.fillRect(0,0,1,1); return Array.from(ctx.getImageData(0,0,1,1).data); };
            const typography = node => {
              const style = getComputedStyle(node);
              return { font: style.fontFamily, size: style.fontSize, weight: style.fontWeight, lineHeight: style.lineHeight, tracking: style.letterSpacing };
            };
            const copy = element.querySelector('.toast-operational-copy');
            return { background: color(s.backgroundColor), color: color(s.color), border: color(s.borderTopColor), radius: s.borderRadius, padding: s.padding, font: s.fontFamily, height: element.getBoundingClientRect().height, width: element.getBoundingClientRect().width, typography: { title: typography(copy.firstElementChild), detail: typography(copy.lastElementChild), action: typography(element.querySelector('button')) } };
          };
          const actual = await toast.evaluate(read), reference = await modern.evaluate(read);
          assert.deepEqual(actual.background, reference.background, tone + ' background ' + theme);
          assert.deepEqual(actual.color, reference.color, tone + ' text ' + theme);
          assert.deepEqual(actual.border, reference.border, tone + ' border ' + theme);
          assert.equal(actual.radius, reference.radius);
          assert.equal(actual.padding, reference.padding);
          assert.equal(actual.font, reference.font);
          assert.deepEqual(actual.typography, reference.typography, tone + ' typography ' + theme);
          assert.ok(Math.abs(actual.width - reference.width) < .5, tone + ' width ' + theme + ': ' + JSON.stringify({ actual: actual.width, reference: reference.width }));
          assert.equal(actual.height, reference.height, tone + ' height ' + theme);
          await page.screenshot({ path: fileURLToPath(new URL(`.cache/screenshots/monitor-toast-${tone}-${theme}.png`, root)) });
        }
        await toast.getByRole('button', { name: 'Ver central', exact: true }).click();
        await expect(frame.locator('#compat-modal')).toBeVisible();
        await frame.getByRole('button', { name: 'Fechar', exact: true }).click();
      }
      for (const mode of ['policy', 'muted', 'zero']) {
        await frame.locator('html').evaluate((_html, mode) => {
          window.PulseCompatibleAudio.setMuted(mode === 'muted');
          window.PulseCompatibleAudio.setVolume(mode === 'zero' ? 0 : .5);
        }, mode);
        const event = { id: 'silent-' + (++revision), incidentId: 'silent-' + revision, targetRef: 'storage:fixture', displayName: 'Storage', message: 'Serviço recuperado', eventType: 'recovery', severity: 'info', announce: true, toastEligible: true, readAt: null, incidentStatus: 'resolved', sound: mode === 'policy' ? false : 'success', createdAt: new Date().toISOString() };
        changes.push({ revision: String(revision), kind: 'incident', payload: { event } });
        const previousPolls = polls;
        await page.clock.fastForward(16000); await expect.poll(() => polls).toBeGreaterThan(previousPolls);
        await page.clock.runFor(2500);
        await expect(toast).toBeVisible(); await expect(toast).toHaveAttribute('data-tone', 'success');
        assert.equal(await frame.locator('html').evaluate(() => window.notificationVoices.length), 4, mode + ' remains silent');
        if (mode === 'zero') {
          await toast.getByRole('button', { name: 'Ver central', exact: true }).focus();
          await page.clock.runFor(9000); await expect(toast).toBeVisible();
          await frame.locator('#compat-theme').focus();
          await page.clock.runFor(9000); await expect(toast).toBeHidden();
        } else {
          await toast.hover(); await page.clock.runFor(9000); await expect(toast).toBeHidden();
        }
      }
      await frame.locator('html').evaluate(() => { window.PulseCompatibleAudio.setMuted(false); window.PulseCompatibleAudio.setVolume(.5); });
      await page.clock.runFor(2000);
      assert.equal(await frame.locator('html').evaluate(() => window.notificationVoices.length), 4, 'Re-enabling sound does not replay discarded arrivals');
      for (const width of [320, 390]) {
        await page.locator('iframe').evaluate((element, width) => { element.style.width = width + 'px'; }, width);
        const event = { id: 'narrow-' + (++revision), incidentId: 'narrow-' + revision, targetRef: 'storage:fixture', displayName: 'Storage de operações com nome longo <img src=x onerror=alert(1)>', message: 'Serviço recuperado e operação normalizada', eventType: 'recovery', severity: 'info', announce: true, toastEligible: true, readAt: null, incidentStatus: 'resolved', sound: false, createdAt: new Date().toISOString() };
        changes.push({ revision: String(revision), kind: 'incident', payload: { event } });
        const previousPolls = polls;
        await page.clock.fastForward(16000); await expect.poll(() => polls).toBeGreaterThan(previousPolls);
        await page.clock.runFor(2500); await expect(toast).toBeVisible();
        assert.equal(await toast.locator('img').count(), 0);
        const bounds = await toast.evaluate(element => { const card = element.getBoundingClientRect(), action = element.querySelector('button').getBoundingClientRect(); return { left: card.left, right: card.right, actionRight: action.right, width: innerWidth }; });
        assert.ok(bounds.left >= 0 && bounds.right <= bounds.width + 1);
        assert.ok(bounds.actionRight <= bounds.right);
        await toast.getByRole('button', { name: 'Ver central', exact: true }).click();
        await frame.getByRole('button', { name: 'Fechar', exact: true }).click();
      }
      assert.deepEqual(errors, []);
    } finally { await context.close(); await browser.close(); await new Promise(resolve => parent.close(resolve)); }
  });
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

test("expanded classic cards keep their profile, responsive columns and complete contents in an opaque iframe", { timeout: 90000 }, async () => {
  await shipped(async base => {
    const fixture = JSON.parse(execFileSync(process.execPath, ['--conditions=react-server', '--input-type=module', '-e', `
      import { monitorFixture } from './tests/fixtures/monitor-compat.mjs';
      import { effectiveOptions } from './lib/config/presentation.ts';
      import { renderCompatibleContent, renderCompatiblePage, compatibleMonitorState } from './lib/server/monitor-compat/render.ts';
      const model = monitorFixture({ cardSize: 'expanded' });
      model.document.publicMonitorAutoScrollOnLoad = false;
      const id = '00000000-0000-4000-8000-000000008200';
      model.screen.blocks.push({ id, type: 'problems', enabled: true, width: 'wide', options: effectiveOptions({ type: 'problems' }) });
      model.overview.data.blocks.push({ blockId: id, type: 'problems', data: [], availability: 'ready', stale: false, lastUpdated: null });
      const snapshot = () => ({ html: renderCompatibleContent(model), state: compatibleMonitorState(model) });
      const page = renderCompatiblePage(model, 'Expanded fixture'), expanded = snapshot();
      model.screen.blocks.find(block => block.type === 'highlighted_resources').options.cardSize = 'compact'; model.document.revision++;
      const compact = snapshot();
      model.screen.blocks.find(block => block.type === 'highlighted_resources').options.cardSize = 'expanded'; model.document.revision++;
      const expandedAgain = snapshot();
      model.screen.blocks.find(block => block.type === 'summary').enabled = false; model.document.revision++;
      const withoutKpis = snapshot();
      model.screen.blocks.find(block => block.type === 'summary').enabled = true; model.document.revision++;
      const withKpisAgain = snapshot();
      model.screen.overviewGrid = 'default'; model.document.revision++;
      const cards = model.overview.data.blocks.find(block => block.type === 'highlighted_resources').data.cards;
      while (cards.length < 13) {
        const item = structuredClone(cards[0].item), id = '00000000-0000-4000-8000-' + String(8300 + cards.length).padStart(12, '0');
        item.id = id; item.config.id = id; cards.push({ kind: 'resource', item });
      }
      const full = snapshot();
      model.screen.overviewGrid = 'split'; model.document.revision++;
      const manualBlock = model.screen.blocks.find(block => block.type === 'highlighted_resources');
      manualBlock.options.rowMode = 'manual'; manualBlock.options.visibleRows = 3;
      const manual = snapshot();
      manualBlock.options.cardSize = 'compact'; manualBlock.options.visibleRows = 1; model.document.revision++;
      process.stdout.write(JSON.stringify({ page, expanded, compact, expandedAgain, withoutKpis, withKpisAgain, full, manual, compactManual: snapshot() }));
    `], { cwd: fileURLToPath(root), encoding: 'utf8', windowsHide: true, maxBuffer: 8 * 1024 * 1024 }));
    let current = fixture.expanded;
    const parent = createServer(async (request, response) => {
      response.setHeader('Access-Control-Allow-Origin', '*');
      if (request.url === '/') {
        response.setHeader('Content-Type', 'text/html');
        response.end('<style>body{margin:0}iframe{width:100vw;height:100vh;border:0}</style><iframe sandbox="allow-scripts" src="/monitor?compat=1"></iframe>');
      } else if (request.url === '/monitor?compat=1') {
        response.setHeader('Content-Type', 'text/html'); response.end(fixture.page);
      } else if (request.url.startsWith('/monitor/compat?fragment=1')) {
        response.setHeader('Content-Type', 'application/json'); response.end(JSON.stringify(current));
      } else {
        const upstream = await fetch(base + request.url);
        response.statusCode = upstream.status; response.setHeader('Content-Type', upstream.headers.get('content-type') ?? 'application/octet-stream');
        response.end(Buffer.from(await upstream.arrayBuffer()));
      }
    });
    const address = await listen(parent), browser = await chromium.launch();
    const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
    try {
      const noJs = await browser.newContext({ javaScriptEnabled: false, viewport: { width: 1280, height: 720 } });
      try {
        const initial = await noJs.newPage(); await initial.goto(address + '/monitor?compat=1');
        const sizes = await initial.locator('.availability-card').evaluateAll(nodes => nodes.map(node => node.getBoundingClientRect().height));
        assert.equal(sizes.length, 6); assert.ok(sizes.every(height => height === 140));
        await expect(initial.locator('.availability-grid')).toHaveAttribute('data-card-rows', '2');
      } finally { await noJs.close(); }
      const page = await context.newPage(); await page.goto(address);
      const frame = page.frameLocator('iframe'), grid = frame.locator('.availability-grid');
      await frame.locator('#compat-content[data-monitor-controller="ready"]').waitFor();
      for (const width of [1280, 1920, 900]) for (const zoom of [70, 100, 125]) {
        await page.setViewportSize({ width, height: 720 });
        await frame.locator('html').evaluate((node, zoom) => { node.style.zoom = zoom + '%'; }, zoom);
        await expect.poll(() => frame.locator('#compat-shell').evaluate(node => Math.round(node.getBoundingClientRect().width))).toBe(width);
        const bounds = await grid.evaluate(node => ({ columns: Number(node.getAttribute('data-card-columns')), cards: Array.from(node.querySelectorAll('.availability-card'), card => ({ height: card.getBoundingClientRect().height, width: card.clientWidth, fits: card.scrollHeight <= card.clientHeight + 1, name: parseFloat(getComputedStyle(card.querySelector('.availability-name')).fontSize) })), footer: document.querySelector('.dashboard-footer').getBoundingClientRect().bottom }));
        assert.ok(bounds.columns >= 1 && bounds.columns <= 3, JSON.stringify(bounds));
        if (width === 1920 && zoom <= 100) assert.equal(bounds.columns, 3);
        if (zoom === 100 && width === 1280) assert.equal(bounds.columns, 2);
        if (zoom === 100 && width === 900) assert.equal(bounds.columns, 1);
        const rows = await grid.evaluate(node => ({ bottom: node.getBoundingClientRect().bottom, scroll: node.scrollHeight - node.clientHeight, cards: Array.from(node.querySelectorAll('.availability-card'), card => ({ top: card.getBoundingClientRect().top, bottom: card.getBoundingClientRect().bottom })) }));
        const headers = await grid.locator('.availability-card-heading').evaluateAll(nodes => nodes.map(node => {
          const name = node.querySelector('.availability-name').getBoundingClientRect(), badge = node.querySelector('.status-pill').getBoundingClientRect();
          return { gap: badge.left - name.right, aligned: name.top < badge.bottom && name.bottom > badge.top, background: getComputedStyle(node.querySelector('.status-pill')).backgroundColor };
        }));
        for (const header of headers) { assert.ok(header.gap >= 5); assert.ok(header.aligned); assert.notEqual(header.background, 'rgba(0, 0, 0, 0)'); }
        for (const card of rows.cards.slice(0, bounds.columns * 2)) assert.ok(card.bottom <= rows.bottom + 1);
        if (rows.cards.length > bounds.columns * 2) { assert.ok(rows.scroll > 0); assert.ok(rows.cards[bounds.columns * 2].top >= rows.bottom); }
        else assert.ok(rows.scroll <= 1);
        for (const card of bounds.cards) { assert.ok(Math.abs(card.height - 140 * zoom / 100) < 1, JSON.stringify({ width, zoom, card })); assert.ok(card.fits); assert.equal(card.name, 15); }
        assert.ok(bounds.footer <= 721 && bounds.footer > 680, JSON.stringify(bounds));
      }
      await page.setViewportSize({ width: 1280, height: 720 });
      await frame.locator('html').evaluate(node => { node.style.zoom = ''; });
      current = fixture.compact; await frame.locator('#compat-refresh').click();
      await expect(grid).toHaveAttribute('data-card-size', 'compact');
      assert.equal(await grid.locator('.availability-card').first().evaluate(node => node.getBoundingClientRect().height), 120);
      current = fixture.expandedAgain; await frame.locator('#compat-refresh').click();
      await expect(grid).toHaveAttribute('data-card-size', 'expanded');
      assert.equal(await grid.locator('.availability-name').first().evaluate(node => getComputedStyle(node).fontSize), '15px');
      await page.screenshot({ path: fileURLToPath(new URL('.cache/screenshots/expanded-classic-grid.png', root)) });
      await frame.getByRole('button', { name: 'Detalhes de Storage configurado', exact: true }).click();
      await expect(frame.locator('#compat-modal')).toBeVisible();
      await expect(frame.locator('#compat-modal')).toContainText('Volume 16');
      await page.screenshot({ path: fileURLToPath(new URL('.cache/screenshots/expanded-classic.png', root)) });
      await frame.locator('#compat-modal button[data-close-modal]').click();
      current = fixture.withoutKpis; await frame.locator('#compat-refresh').click();
      await expect(grid).toHaveAttribute('data-card-rows', '3');
      const noKpis = await grid.evaluate(node => ({ bottom: node.getBoundingClientRect().bottom, scroll: node.scrollHeight - node.clientHeight, cards: Array.from(node.querySelectorAll('.availability-card'), card => card.getBoundingClientRect().bottom) }));
      assert.ok(noKpis.cards.every(bottom => bottom <= noKpis.bottom + 1)); assert.ok(noKpis.scroll <= 1);
      current = fixture.withKpisAgain; await frame.locator('#compat-refresh').click();
      await expect(grid).toHaveAttribute('data-card-rows', '2');
      current = fixture.full; await frame.locator('#compat-refresh').click();
      await expect(grid).toHaveAttribute('data-card-rows', '2');
      const full = await grid.evaluate(node => ({ columns: Number(node.getAttribute('data-card-columns')), bottom: node.getBoundingClientRect().bottom, cards: Array.from(node.querySelectorAll('.availability-card'), card => ({ top: card.getBoundingClientRect().top, bottom: card.getBoundingClientRect().bottom })) }));
      for (const card of full.cards.slice(0, full.columns * 2)) assert.ok(card.bottom <= full.bottom + 1);
      assert.ok(full.cards[full.columns * 2].top >= full.bottom);
      current = fixture.manual; await frame.locator('#compat-refresh').click();
      await expect(grid).toHaveAttribute('data-card-rows', '3');
      await expect(grid).toHaveAttribute('data-row-mode', 'manual');
      const manual = await grid.evaluate(node => ({ bottom: node.getBoundingClientRect().bottom, columns: Number(node.getAttribute('data-card-columns')), cards: Array.from(node.querySelectorAll('.availability-card'), card => ({ top: card.getBoundingClientRect().top, bottom: card.getBoundingClientRect().bottom })) }));
      for (const card of manual.cards.slice(0, manual.columns * 3)) assert.ok(card.bottom <= manual.bottom + 1);
      assert.ok(manual.cards[manual.columns * 3].top >= manual.bottom);
      current = fixture.compactManual; await frame.locator('#compat-refresh').click();
      await expect(grid).toHaveAttribute('data-card-rows', '1');
      await expect(grid).toHaveAttribute('data-card-size', 'compact');
      const one = await grid.evaluate(node => ({ bottom: node.getBoundingClientRect().bottom, height: node.getBoundingClientRect().height, cards: Array.from(node.querySelectorAll('.availability-card'), card => ({ top: card.getBoundingClientRect().top, bottom: card.getBoundingClientRect().bottom })) }));
      assert.equal(one.height, 128);
      const firstRow = one.cards.filter(card => Math.abs(card.top - one.cards[0].top) < 1);
      for (const card of firstRow) assert.ok(card.bottom <= one.bottom + 1);
      assert.ok(one.cards[firstRow.length].top >= one.bottom);
    } finally { await context.close(); await browser.close(); parent.closeAllConnections(); await new Promise(resolve => parent.close(resolve)); }
  });
});

test("classic KPI scale survives snapshots and opaque iframe zoom with indicators hidden", { timeout: 90000 }, async () => {
  await shipped(async base => {
    const browser = await chromium.launch();
    try {
      for (const includeStorage of [false, true]) {
        const fixture = JSON.parse(execFileSync(process.execPath, ['--conditions=react-server', '--input-type=module', '-e', `
          import { monitorFixture } from './tests/fixtures/monitor-compat.mjs';
          import { renderCompatibleContent, renderCompatiblePage, compatibleMonitorState } from './lib/server/monitor-compat/render.ts';
          const model = monitorFixture({ includeStorage: ${includeStorage}, fontScalePercent: 150 });
          model.document.publicMonitorAutoScrollOnLoad = false;
          const snapshot = () => ({ html: renderCompatibleContent(model), state: compatibleMonitorState(model) });
          const page = renderCompatiblePage(model, 'KPI fixture'), variants = [];
          for (const scale of [100,110,125,150]) {
            model.screen.blocks.find(block => block.type === 'summary').options.fontScalePercent = scale;
            model.document.revision++; variants.push(snapshot());
          }
          model.screen.blocks.find(block => block.type === 'summary').enabled = false;
          model.document.revision++;
          process.stdout.write(JSON.stringify({ page, variants, hidden: snapshot() }));
        `], { cwd: fileURLToPath(root), encoding: 'utf8', windowsHide: true, maxBuffer: 8 * 1024 * 1024 }));
        let current = fixture.variants[3];
        const server = createServer(async (request, response) => {
          response.setHeader('Access-Control-Allow-Origin', '*');
          if (request.url === '/') {
            response.setHeader('Content-Type', 'text/html');
            response.end('<style>body{margin:0}iframe{width:1280px;height:720px;border:0}</style><iframe sandbox="allow-scripts" src="/monitor?compat=1"></iframe>');
          } else if (request.url === '/monitor?compat=1') {
            response.setHeader('Content-Type', 'text/html'); response.end(fixture.page);
          } else if (request.url.startsWith('/monitor/compat?fragment=1')) {
            response.setHeader('Content-Type', 'application/json'); response.end(JSON.stringify(current));
          } else {
            const upstream = await fetch(base + request.url);
            response.statusCode = upstream.status;
            response.setHeader('Content-Type', upstream.headers.get('content-type') ?? 'application/octet-stream');
            response.end(Buffer.from(await upstream.arrayBuffer()));
          }
        });
        const address = await listen(server), context = await browser.newContext({ viewport: { width: 1366, height: 768 } });
        try {
          const noJs = await browser.newContext({ javaScriptEnabled: false });
          try {
            const initial = await noJs.newPage(); await initial.goto(address + '/monitor?compat=1');
            assert.equal(await initial.locator('.kpi-value').first().evaluate(node => getComputedStyle(node).fontSize), '42px');
          } finally { await noJs.close(); }
          const page = await context.newPage(); await page.goto(address);
          const frame = page.frameLocator('iframe');
          await frame.locator('#compat-content[data-monitor-controller="ready"]').waitFor();
          for (const [index, scale] of [100,110,125,150].entries()) {
            current = fixture.variants[index]; await frame.locator('#compat-refresh').click();
            await expect(frame.locator('.dashboard-kpis')).toHaveAttribute('data-kpi-font-scale', String(scale));
            const styles = await frame.locator('.dashboard-kpi').first().evaluate(node => ({ value: parseFloat(getComputedStyle(node.querySelector('.kpi-value')).fontSize), label: parseFloat(getComputedStyle(node.querySelector('h2')).fontSize), note: parseFloat(getComputedStyle(node.querySelector('p:last-child')).fontSize), icon: getComputedStyle(node.querySelector('svg')).width }));
            assert.ok(Math.abs(styles.value - 28 * scale / 100) < .01, JSON.stringify(styles));
            assert.ok(Math.abs(styles.label - 12 * scale / 100) < .01);
            assert.ok(Math.abs(styles.note - 10 * scale / 100) < .01);
            assert.equal(styles.icon, '18px');
          }
          current = fixture.hidden; await frame.locator('#compat-refresh').click();
          await expect(frame.locator('.dashboard-kpis')).toHaveCount(0);
          for (const zoom of [50,70,100,125,150]) {
            await frame.locator('html').evaluate((node, zoom) => { node.style.zoom = zoom + '%'; }, zoom);
            await expect.poll(() => frame.locator('#compat-shell').evaluate(node => Math.round(node.getBoundingClientRect().width))).toBe(1280);
            const bounds = await frame.locator('#compat-shell').evaluate(node => ({ footer: node.querySelector('.dashboard-footer').getBoundingClientRect().bottom, bottom: Math.max(...Array.from(node.querySelectorAll('.compat-row'), row => row.getBoundingClientRect().bottom)), body: node.querySelector('.block-asgard_summary .panel-content').clientHeight }));
            assert.ok(bounds.footer <= 721 && bounds.footer >= 690, JSON.stringify({ zoom, bounds }));
            assert.ok(bounds.footer - bounds.bottom < 45 && bounds.body > 40, JSON.stringify({ zoom, bounds }));
          }
        } finally { await context.close(); await new Promise(resolve => server.close(resolve)); }
      }
    } finally { await browser.close(); }
  });
});

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
      await page.getByRole('button', { name: 'Pausar rolagem automática', exact: true }).click();
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


test("classic monitor auto-scroll preserves manual reading, refresh positions and opaque iframe bounds", { timeout: 60000 }, async () => {
  let fixture = JSON.parse(execFileSync(process.execPath, ['--conditions=react-server', 'tests/fixtures/monitor-compat.mjs'], { cwd: fileURLToPath(root), encoding: 'utf8' }));
  const pausedFixture = JSON.parse(execFileSync(process.execPath, ['--conditions=react-server', 'tests/fixtures/monitor-compat.mjs', '100', 'false'], { cwd: fileURLToPath(root), encoding: 'utf8' }));
  await shipped(async base => {
    let parentAddress;
    const parent = createServer((request, response) => {
      response.writeHead(200, { 'Content-Type': 'text/html' });
      // A real document response retains loopback address-space metadata in an opaque iframe.
      if (request.url.startsWith('/monitor?')) response.end(fixture.page.replace('<head>', `<head><base href="${base}/">`));
      else response.end(`<style>body{margin:0}iframe{width:1280px;height:720px;border:0}</style><iframe title="Monitor" sandbox="allow-scripts" src="${parentAddress}/monitor?compat=1"></iframe>`);
    });
    parentAddress = await listen(parent);
    const browser = await chromium.launch();
    const context = await browser.newContext({ viewport: { width: 1280, height: 720 }, reducedMotion: 'reduce', userAgent: oldUa });
    try {
      const page = await context.newPage(), errors = [];
      page.on('pageerror', error => { errors.push(error.message); console.error('Classic scrolling page error:', error.message); });
      page.on('requestfailed', request => { const error = new URL(request.url()).pathname + ': ' + request.failure()?.errorText; errors.push(error); console.error('Classic scrolling request failed:', error); });
      page.on('console', message => { if (message.type() === 'error') { errors.push(message.text()); console.error('Classic scrolling console:', message.text()); } });
      await page.route('**/monitor/compat?fragment=1*', route => route.fulfill({ headers: { 'Access-Control-Allow-Origin': '*' }, json: fixture.snapshot }));
      await page.route('**/monitor/compat/notifications**', route => route.fulfill({ headers: { 'Access-Control-Allow-Origin': '*' }, json: {
        counts: { unreadCount: 0, activeCount: 0 }, runtime: { enabled: false, deliveryRevision: '1' }, serverTime: new Date().toISOString(),
        events: [], incidents: [], changes: [], syncCursor: 'test', nextCursor: 'test', hasMore: false, nextPageCursor: null,
      } }));
      await page.goto(parentAddress);
      const frame = page.frameLocator('iframe[title="Monitor"]');
      await frame.locator('#compat-content[data-monitor-controller="ready"]').waitFor();
      const region = frame.locator('.block-asgard_summary .panel-content[data-monitor-auto-scroll]');
      await region.waitFor();
      const top = () => region.evaluate(element => element.scrollTop);
      for (let attempt = 0; attempt < 40 && await top() <= 12; attempt++) await delay(100);
      assert.ok(await top() > 12, 'Automatic motion starts after the reading pause');
      await frame.getByRole('button', { name: 'Pausar rolagem automática', exact: true }).click();
      await delay(100);
      const pausedAt = await top(); await delay(700); assert.equal(await top(), pausedAt);
      const refreshed = page.waitForResponse(response => response.url().includes('/monitor/compat?fragment=1'));
      await frame.locator('#compat-refresh').click(); await refreshed;
      await frame.locator('#compat-content[data-connection="ready"]').waitFor();
      assert.equal(await top(), pausedAt, 'Replacing a snapshot preserves the position');
      await frame.getByRole('button', { name: 'Retomar rolagem automática', exact: true }).click();
      for (let attempt = 0; attempt < 40 && await top() <= pausedAt + 12; attempt++) await delay(100);
      assert.ok(await top() > pausedAt + 12);
      await region.focus(); await region.press('End');
      for (let attempt = 0; attempt < 30 && !await region.evaluate(element => element.scrollTop >= element.scrollHeight - element.clientHeight - 1); attempt++) await delay(100);
      const bottom = await region.evaluate(element => ({ top: element.scrollTop, max: element.scrollHeight - element.clientHeight }));
      assert.ok(bottom.top >= bottom.max - 1);
      await delay(700); assert.equal(await top(), bottom.top, 'Keyboard reading remains manual');
      await frame.locator('#compat-notifications').click(); await delay(150);
      const modalAt = await top(); await delay(700); assert.equal(await top(), modalAt);
      await frame.getByRole('button', { name: 'Fechar', exact: true }).click();
      const bounds = await frame.locator('#compat-shell').boundingBox();
      assert.ok(Math.abs(bounds.width - 1280) < 2 && Math.abs(bounds.height - 720) < 2, JSON.stringify(bounds));
      assert.equal(await frame.locator('#compat-content').evaluate(element => element.ownerDocument.scrollingElement.scrollTop), 0);
      assert.equal(await frame.locator('#compat-modal [data-monitor-auto-scroll]').count(), 0);
      await page.emulateMedia({ reducedMotion: 'no-preference' });
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await frame.getByRole('button', { name: 'Pausar rolagem automática', exact: true }).waitFor();
      fixture = pausedFixture;
      const reloaded = page.waitForResponse(response => response.url() === parentAddress + '/monitor?compat=1');
      await frame.locator('#compat-content').evaluate(() => location.reload()); await reloaded;
      await frame.getByRole('button', { name: 'Retomar rolagem automática', exact: true }).waitFor();
      await region.waitFor(); await delay(2800);
      assert.equal(await top(), 0, 'Disabled startup stays paused even with overflowing content');
      await frame.getByRole('button', { name: 'Retomar rolagem automática', exact: true }).click();
      for (let attempt = 0; attempt < 40 && await top() <= 12; attempt++) await delay(100);
      assert.ok(await top() > 12, 'The manual button can resume a disabled startup in reduced motion');
      assert.deepEqual(errors, []);
    } finally { await context.close(); await browser.close(); await new Promise(resolve => parent.close(resolve)); }
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
      const page = await context.newPage(), configuration = await fetch(base + '/api/public/settings/presentation').then(r => r.json()), errors = [];
      page.on('pageerror', error => { errors.push(error.message); console.error('Modern monitor page error:', error.message); });
      configuration.data.displayScalePercent = 125;
      configuration.data.publicMonitorZoomPercent = 70;
      await page.route('**/api/public/settings/presentation', route => route.fulfill({ json: configuration }));
      await page.goto(base + '/monitor?compat=0');
      await page.locator('[data-public-monitor-zoom="70"]').waitFor();
      await page.getByRole('heading', { name: 'Disponibilidade de Serviços', exact: true }).waitFor();
      async function fitted(width, height) {
        const current = await page.locator('.public-monitor-stage').evaluate(element => ({
          width: element.getBoundingClientRect().width, height: element.getBoundingClientRect().height,
          shellHeight: element.querySelector('.dashboard-shell').getBoundingClientRect().height,
          footer: element.querySelector('.dashboard-footer').getBoundingClientRect().bottom,
          panelsBottom: Math.max(...Array.from(element.querySelectorAll('.dashboard-panel'), panel => panel.getBoundingClientRect().bottom)),
          zoom: element.parentElement.getAttribute('data-public-monitor-zoom'),
          rows: getComputedStyle(element.querySelector('.dashboard-blocks')).gridTemplateRows,
          contentHeight: element.querySelector('.dashboard-blocks').clientHeight,
          contentScrollHeight: element.querySelector('.dashboard-blocks').scrollHeight,
        }));
        assert.ok(Math.abs(current.width - width) < 2 && Math.abs(current.height - height) < 2, JSON.stringify(current));
        assert.ok(Math.abs(current.shellHeight - height) < 2 && current.footer > height - 32 && current.footer <= height + 1, JSON.stringify(current));
        if (current.contentScrollHeight > current.contentHeight + 1) {
          // High zoom preserves useful panel bodies by scrolling the composition, rather than collapsing them.
          const composition = page.locator('.dashboard-blocks');
          await composition.evaluate(element => { element.scrollTop = element.scrollHeight; });
          const lastBottom = await page.locator('.dashboard-panel').last().evaluate(element => element.getBoundingClientRect().bottom);
          assert.ok(lastBottom > height - 60 && lastBottom <= height, JSON.stringify({ ...current, lastBottom }));
          assert.ok(await page.locator('.asgard-content').evaluate(element => element.clientHeight > 40));
          await composition.evaluate(element => { element.scrollTop = 0; });
        } else {
          assert.ok(current.panelsBottom > height - 60 && current.panelsBottom <= height, JSON.stringify(current));
        }
      }
      const bounds = await page.locator('.public-monitor-stage').evaluate(element => ({ width: element.getBoundingClientRect().width, height: element.getBoundingClientRect().height, shellHeight: element.querySelector('.dashboard-shell').getBoundingClientRect().height, scale: element.querySelector('.dashboard-shell').getAttribute('data-display-scale'), footer: element.querySelector('.dashboard-footer').getBoundingClientRect().bottom }));
      assert.ok(Math.abs(bounds.width - 1920) < 2 && Math.abs(bounds.height - 1080) < 2, JSON.stringify(bounds));
      assert.ok(Math.abs(bounds.shellHeight - 1080) < 2 && bounds.footer > 1050 && bounds.footer <= 1081, JSON.stringify(bounds));
      assert.equal(bounds.scale, '100');
      for (const zoom of [50, 100, 125, 150, 70]) {
        configuration.data.publicMonitorZoomPercent = zoom;
        await page.reload();
        await page.locator(`[data-public-monitor-zoom="${zoom}"]`).waitFor();
        await page.getByRole('heading', { name: 'Disponibilidade de Serviços', exact: true }).waitFor();
        const current = await page.locator('.public-monitor-stage').boundingBox();
        assert.ok(Math.abs(current.width - 1920) < 2 && Math.abs(current.height - 1080) < 2, JSON.stringify({ zoom, current }));
        await fitted(1920, 1080);
        assert.equal(await page.locator('.dashboard-shell').getAttribute('data-display-scale'), '100');
      }
      await page.addStyleTag({ path: fileURLToPath(new URL('components/dashboard/dashboard.css', root)) });
      await page.addStyleTag({ path: fileURLToPath(new URL('components/dashboard/storage-composition.css', root)) });
      await fitted(1920, 1080);
      configuration.data.screens[0].overviewGrid = 'split';
      await page.reload(); await page.locator('.overview-split-grid').waitFor(); await fitted(1920, 1080);
      await page.getByRole('button', { name: 'Sair do modo TV', exact: true }).click();
      await fitted(1920, 1080);
      await page.screenshot({ path: fileURLToPath(new URL('.cache/screenshots/monitor-02-modern.png', root)) });
      const storage = JSON.parse(execFileSync(process.execPath, ['--conditions=react-server', '--input-type=module', '-e', "import { monitorFixture } from './tests/fixtures/monitor-compat.mjs'; process.stdout.write(JSON.stringify(monitorFixture()));"], { cwd: fileURLToPath(root), encoding: 'utf8' }));
      configuration.data = { ...storage.document, publicMonitorZoomPercent: 70 };
      for (const block of storage.overview.data.blocks) block.options = configuration.data.screens[0].blocks.find(item => item.id === block.blockId).options;
      await page.route('**/api/public/dashboard/overview*', route => route.fulfill({ json: storage.overview }));
      for (const layout of ['overview', 'wall']) {
        configuration.data.screens[0].layout = layout;
        await page.reload(); await page.locator('.storage-composition').waitFor();
        await page.addStyleTag({ path: fileURLToPath(new URL('components/dashboard/storage-composition.css', root)) });
        await fitted(1920, 1080);
      }
      await page.setViewportSize({ width: 1280, height: 720 });
      const compact = await page.locator('.public-monitor-stage').evaluate(element => ({ width: element.getBoundingClientRect().width, height: element.getBoundingClientRect().height, footer: element.querySelector('.dashboard-footer').getBoundingClientRect().bottom }));
      assert.ok(Math.abs(compact.width - 1280) < 2 && Math.abs(compact.height - 720) < 2 && compact.footer > 690 && compact.footer <= 721, JSON.stringify(compact));
      const response = await page.request.get(base + '/monitor?compat=0');
      assert.match(await response.text(), /data-public-monitor-zoom="100"/);
      assert.equal(await page.locator('html').evaluate(e => e.style.zoom), '');
      assert.deepEqual(errors, []);
      await page.goto(base + '/');
      assert.equal(await page.locator('.public-monitor-frame').count(), 0);
    } finally { await context.close(); await browser.close(); }
  });
});
