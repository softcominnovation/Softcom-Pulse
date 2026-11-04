import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ts from "typescript";
import { needsCompatibleMonitor } from "../lib/public/monitor-compatibility.ts";
import { readCompatibleMonitor } from "../lib/server/monitor-compat/read.ts";
import { compatibleMonitorState, renderCompatibleContent, renderCompatiblePage } from "../lib/server/monitor-compat/render.ts";
import { compatibleNotificationPayload } from "../lib/server/monitor-compat/notifications.ts";
import { compatibleAssetUrl } from "../lib/server/monitor-compat/assets.ts";
import { createHash } from "node:crypto";
import { initialPublicMonitorSettings } from "../lib/server/monitor-compat/settings.ts";
import { buildDemoHosts, buildDemoOverview, buildDemoPresentation } from "../lib/server/monitoring/demo-data.ts";
import { monitorFixture } from "./fixtures/monitor-compat.mjs";

test("classic KPI text scales before scripts and hidden indicators leave no summary band", () => {
  const model = monitorFixture({ fontScalePercent: 150 });
  const html = renderCompatibleContent(model);
  assert.match(html, /data-kpi-font-scale="150"/);
  assert.match(html, /<h2 style="font-size:18px;line-height:1.45"/);
  assert.match(html, /class="kpi-value" style="font-size:42px;line-height:1.15"/);
  assert.match(html, /<p style="font-size:15px;line-height:1.45"/);
  const hidden = renderCompatibleContent(monitorFixture({ summaryEnabled: false }));
  assert.doesNotMatch(hidden, /class="compat-summary"|class="dashboard-kpis"/);
  assert.match(hidden, /block-asgard_summary/);
});

test("classic routing detects old engines without downgrading supported browsers", () => {
  for (const ua of ["Chrome/83.0", "Firefox/127.0", "Version/16.3 Safari/605", "TV Browser", ""]) assert.equal(needsCompatibleMonitor(ua), true, ua);
  for (const ua of ["Chrome/145.0", "Firefox/128.0", "Version/16.4 Safari/605"]) assert.equal(needsCompatibleMonitor(ua), false, ua);
});

test("monitor reads initial zoom and scroll anonymously and falls back safely when settings fail", async () => {
  const model = monitorFixture(); model.document.publicMonitorZoomPercent = 70; model.document.publicMonitorAutoScrollOnLoad = false;
  assert.deepEqual(await initialPublicMonitorSettings('allowed.test', async request => {
    assert.equal(request.headers.get('host'), 'allowed.test');
    assert.equal(request.headers.has('cookie'), false); assert.equal(request.headers.has('authorization'), false);
    return Response.json({ data: model.document });
  }), { publicMonitorZoomPercent: 70, publicMonitorAutoScrollOnLoad: false });
  for (const reader of [async () => new Response('', { status: 403 }), async () => Response.json({ data: {} }), async () => { throw Error('offline'); }]) assert.deepEqual(await initialPublicMonitorSettings('allowed.test', reader), { publicMonitorZoomPercent: 100, publicMonitorAutoScrollOnLoad: true });
});

test("classic initial scroll follows the shared setting before the controller loads", () => {
  const model = monitorFixture();
  for (const enabled of [false, true]) {
    model.document.publicMonitorAutoScrollOnLoad = enabled;
    assert.equal(compatibleMonitorState(model).autoScrollOnLoad, enabled);
    const button = renderCompatiblePage(model, 'Pulse').match(/<button[^>]+id="compat-auto-scroll"[^>]*>/)?.[0];
    assert.ok(button);
    assert.ok(button.includes(`aria-label="${enabled ? 'Pausar' : 'Retomar'} rolagem automática"`));
    assert.ok(button.includes(`aria-pressed="${!enabled}"`));
  }
});

test("classic SSR applies configured zoom before scripts and ignores the TV scale", () => {
  const model = monitorFixture(); model.document.publicMonitorZoomPercent = 70; model.document.displayScalePercent = 125;
  const html = renderCompatiblePage(model, 'Pulse');
  assert.match(html, /style="zoom:70%"/); assert.match(html, /width:142\.857/);
  assert.equal(compatibleMonitorState(model).scale, 100);
  assert.equal(compatibleMonitorState(model).zoomPercent, 70);
  assert.doesNotMatch(html.match(/<span id="compat-audio"[\s\S]*?<\/noscript>\s*<\/span>/)?.[0] ?? '', /type="range"|compat-test-sound/);
});

test("classic reader uses current public handlers without forwarding cookies or Authorization", async () => {
  const saved = process.env.PULSE_PUBLIC_HOSTS;
  process.env.PULSE_PUBLIC_HOSTS = "127.0.0.1";
  try {
    const calls = [];
    const reader = async (request, segments) => {
      calls.push({ request, segments });
      return Response.json(segments[0] === "settings" ? buildDemoPresentation() : buildDemoOverview(new URL(request.url).searchParams.get("screenId")));
    };
    const request = path => new Request("http://127.0.0.1/monitor" + path, { headers: { Host: "127.0.0.1", Cookie: "session=private", Authorization: "Bearer private" } });
    const result = await readCompatibleMonitor(request("?compat=1"), reader);
    assert.equal(result.tv, true);
    assert.equal(calls.length, 2);
    for (const call of calls) {
      assert.equal(call.request.headers.get("Host"), "127.0.0.1");
      assert.equal(call.request.headers.has("Cookie"), false);
      assert.equal(call.request.headers.has("Authorization"), false);
    }
    const denied = await readCompatibleMonitor(new Request("http://other.test/monitor", { headers: { Host: "other.test", "X-Forwarded-Host": "127.0.0.1" } }), reader);
    assert.equal(denied.status, 403);
    for (const query of ["?layout=invalid", "?tv=1&tv=0", "?compat=invalid"]) assert.equal((await readCompatibleMonitor(request(query), reader)).status, 400);
  } finally { if (saved === undefined) delete process.env.PULSE_PUBLIC_HOSTS; else process.env.PULSE_PUBLIC_HOSTS = saved; }
});

test("classic cards preserve current resource and Signal metric pairs, capacity and traffic", () => {
  const model = monitorFixture();
  const html = renderCompatibleContent(model);
  const mini = name => html.slice(html.indexOf('aria-label="Detalhes de ' + name + '"')).split('class="detail-source"')[0];
  assert.match(mini("VM configurada"), />CPU</); assert.match(mini("VM configurada"), />Disco</);
  assert.doesNotMatch(mini("VM configurada"), />RAM</);
  assert.match(mini("Serviço configurado"), />Disco da VM</); assert.match(mini("Serviço configurado"), />RAM</);
  assert.doesNotMatch(mini("Serviço configurado"), />CPU</);
  assert.match(mini("Serviço configurado"), /2 h/);
  assert.match(mini("VM configurada"), /Volumes configurados/);
  assert.match(mini("Storage configurado"), /RX/); assert.match(mini("Storage configurado"), /TX/);
  assert.match(html, /VM de teste 40/); assert.match(html, /Volume 16/);
  assert.match(html, /class="panel-content" tabindex="0" role="region"/);
  assert.deepEqual(compatibleMonitorState(model).screens.map(screen => screen.id), model.screens.map(screen => screen.id));
});

test("classic initial HTML has SVGs, sound controls and escaped configuration without zoom sensors", () => {
  const model = monitorFixture(); model.screens[0].name = '</script><script>alert("injected")</script>';
  const html = renderCompatiblePage(model, '<img src=x onerror="injected">');
  assert.doesNotMatch(html, /<script>alert|<img src=x|compat-zoom-sensor|\/_next\//);
  for (const id of ["compat-mute", "compat-volume", "compat-test-sound", "compat-count"]) assert.match(html, new RegExp('id="' + id + '"'));
  assert.match(html, /xmlns="http:\/\/www.w3.org\/2000\/svg"/);
  assert.match(html, /data-icon="bell"/);
  assert.match(html, /\\u003c\/script\\u003e/);
});

test("remaining current block families render public data without exposing container inventory", () => {
  const original = monitorFixture();
  const resource = original.overview.data.blocks.find(block => block.type === "highlighted_resources").data.cards[0].item;
  for (const [type, data] of [["resource_card", resource], ["host_inventory", buildDemoHosts()], ["uptime_list", original.overview.data.externalServices], ["problems", []], ["container_inventory", null]]) {
    const model = structuredClone(original), block = { id: original.screen.blocks[0].id, type, enabled: true, width: "full", ...(type === "resource_card" ? { resourceConfigId: resource.id } : {}) };
    model.screen.blocks = [block];
    model.overview.data.blocks = [{ blockId: block.id, type, data, availability: "ready", stale: false, lastUpdated: new Date().toISOString() }];
    const html = renderCompatibleContent(model);
    assert.doesNotMatch(html, /Este bloco não está disponível nesta superfície/);
    if (type === "container_inventory") assert.match(html, /só está disponível para usuários logados/);
  }
});

test("classic notification adapter formats current usage context and preserves cursors and policy", () => {
  const entry = { messageCode: "usage_disk", targetRef: "storage:00000000-0000-4000-8000-000000000001", metricContext: { metric: "disk", valuePercent: 72.5, thresholdPercent: 70, recoveryPercent: 65, source: "agent", observedAt: new Date().toISOString(), coverage: "Volumes selecionados" } };
  const payload = { syncCursor: "opaque", events: [entry], incidents: [entry], changes: [{ revision: "1", payload: { event: entry } }], runtime: { enabled: true, deliveryRevision: "4" } };
  const adapted = compatibleNotificationPayload(payload);
  assert.match(adapted.events[0].message, /Disco do Storage em 72,5% · limite 70%/);
  assert.equal(adapted.events[0].message, adapted.changes[0].payload.event.message);
  assert.equal(adapted.syncCursor, "opaque"); assert.deepEqual(adapted.runtime, payload.runtime);
  assert.equal(payload.events[0].message, undefined);
});

test("classic browser scripts parse as ES5 and omit the rejected viewport calibration", async () => {
  for (const file of ["monitor-compat.js", "monitor-compat-bootstrap.js", "monitor-compat-audio.js", "monitor-auto-scroll.js"]) {
    const source = await readFile(new URL("../public/" + file, import.meta.url), "utf8");
    const parsed = ts.createSourceFile(file, source, ts.ScriptTarget.ES5, true, ts.ScriptKind.JS);
    assert.deepEqual(parsed.parseDiagnostics, [], file);
    function check(node) {
      assert.ok(![ts.SyntaxKind.ArrowFunction, ts.SyntaxKind.ClassDeclaration, ts.SyntaxKind.TemplateExpression, ts.SyntaxKind.NoSubstitutionTemplateLiteral, ts.SyntaxKind.AwaitExpression].includes(node.kind), file + ": modern syntax");
      if (ts.isVariableDeclarationList(node)) assert.equal(node.flags & (ts.NodeFlags.Let | ts.NodeFlags.Const), 0, file);
      ts.forEachChild(node, check);
    }
    check(parsed);
    assert.doesNotMatch(source, /devicePixelRatio|viewportMetrics|effectiveZoom|zoomObserver/);
  }
  const css = await readFile(new URL("../public/monitor-compat.css", import.meta.url), "utf8");
  assert.doesNotMatch(css, /oklch\(|color-mix\(|var\(--|transform:\s*scale|zoom:\s*/);
});

test("classic asset URLs identify the actual content so a cached controller cannot cross versions", async () => {
  for (const file of ["monitor-compat.js", "monitor-compat.css", "monitor-compat-notifications.css", "monitor-compat-audio.js", "monitor-compat-bootstrap.js", "monitor-auto-scroll.js"]) {
    const content = await readFile(new URL("../public/" + file, import.meta.url));
    const digest = createHash("sha256").update(content).digest("hex").slice(0, 20);
    assert.equal(compatibleAssetUrl(file), '/' + file + '?v=' + digest);
  }
  const model = monitorFixture(), html = renderCompatiblePage(model, "Pulse");
  for (const file of ["monitor-compat.css", "monitor-compat-notifications.css", "monitor-compat.js", "monitor-auto-scroll.js"]) assert.ok(html.includes(compatibleAssetUrl(file)));
  assert.ok(html.indexOf(compatibleAssetUrl("monitor-auto-scroll.js")) < html.indexOf(compatibleAssetUrl("monitor-compat.js")));
  assert.equal(compatibleMonitorState(model).audioAdapterUrl, compatibleAssetUrl("monitor-compat-audio.js"));
});
