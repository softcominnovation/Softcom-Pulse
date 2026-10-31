import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ts from "typescript";
import { needsCompatibleMonitor } from "../lib/public/monitor-compatibility.ts";
import { readCompatibleMonitor } from "../lib/server/monitor-compat/read.ts";
import { renderCompatibleContent, renderCompatiblePage } from "../lib/server/monitor-compat/render.ts";
import { buildDemoOverview, buildDemoPresentation, buildDemoSignalTargets } from "../lib/server/monitoring/demo-data.ts";
import { blockTypes, effectiveOptions } from "../lib/config/presentation.ts";

const chromium83 = "Mozilla/5.0 (Linux; Android 10; TV Build/Q) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/83.0.4103.120 Safari/537.36";
function fixture() {
  const document = buildDemoPresentation().data;
  return { document, screens: document.screens, screen: document.screens[0], overview: buildDemoOverview(document.screens[0].id), error: null, layout: "overview", tv: false, theme: "dark", now: Date.now(), refreshAfterMs: 20000 };
}
const metric = (value, unit = "percent") => ({ value, unit, quality: "fresh", observedAt: new Date().toISOString(), validUntil: new Date(Date.now() + 60000).toISOString() });
function storage() {
  return {
    configId: "00000000-0000-4000-8000-000000000333", storageKey: "storage-test", displayName: "Storage de teste", description: null,
    critical: true, dashboardEnabled: true, stale: false, presentationStatus: "ready", resolution: "resolved", monitoringEnabled: true, availability: "reachable",
    evidence: { observedAt: metric(1).observedAt, validUntil: metric(1).validUntil }, classification: { observedAt: metric(1).observedAt, validUntil: metric(1).validUntil },
    metrics: { cpuUsagePercent: metric(4), memoryUsagePercent: metric(8), ioWaitPercent: metric(0), uptimeSeconds: metric(1000, "seconds") },
    capacity: { coverage: "complete", label: "Volumes selecionados", filesystemKeys: ["root"], usedBytes: metric(250, "bytes"), totalBytes: metric(1000, "bytes"), availableBytes: metric(750, "bytes"), usagePercent: metric(25) },
    volumes: [{ key: "root", name: "Volume 1", metrics: { diskUsagePercent: metric(25), diskUsedBytes: metric(250, "bytes"), diskTotalBytes: metric(1000, "bytes") }, availableBytes: metric(750, "bytes"), readOnly: metric(0, "count"), inodesFreePercent: metric(99) }],
    selectedInterface: { key: "network", name: "Interface selecionada", metrics: { networkReceiveBitsPerSecond: metric(150000, "bits/s"), networkTransmitBitsPerSecond: metric(50000, "bits/s") } },
  };
}

test("compatible routing covers old Chromium, old Safari, unknown UAs and modern boundaries", () => {
  for (const ua of [chromium83, "Chrome/110.0.0.0", "Firefox/127.0", "Version/16.3 Safari/605.1.15", "iPhone OS 16_3 like Mac OS X Version/16.3 Mobile Safari/604.1", "TV Browser", ""]) assert.equal(needsCompatibleMonitor(ua), true, ua);
  for (const ua of ["Chrome/111.0.0.0", "Chrome/145.0.0.0", "Firefox/128.0", "Version/16.4 Safari/605.1.15", "iPhone OS 16_4 like Mac OS X Version/16.4 Mobile Safari/604.1"]) assert.equal(needsCompatibleMonitor(ua), false, ua);
});

test("server reader gates Host, strips credentials and uses only public reads", async () => {
  const previous = process.env.PULSE_PUBLIC_HOSTS;
  process.env.PULSE_PUBLIC_HOSTS = "localhost";
  try {
    const model = fixture(), calls = [];
    const reader = async (request, segments) => {
      calls.push({ request, segments });
      return Response.json(segments[0] === "settings" ? { data: model.document } : model.overview);
    };
    const request = query => new Request("http://localhost/monitor" + query, { headers: { Host: "localhost:3000", Authorization: "Bearer secret", Cookie: "session=secret", Origin: "null" } });
    const result = await readCompatibleMonitor(request("?tv=1&layout=wall&theme=light"), reader);
    assert.equal(result.tv, true); assert.equal(result.layout, "wall"); assert.equal(result.theme, "light");
    assert.equal(result.overview.data.screenId, model.screen.id);
    assert.deepEqual(calls.map(call => call.segments), [["settings", "presentation"], ["dashboard", "overview"]]);
    for (const { request: forwarded } of calls) {
      assert.equal(forwarded.method, "GET"); assert.equal(forwarded.headers.get("Host"), "localhost:3000");
      assert.equal(forwarded.headers.get("Authorization"), null); assert.equal(forwarded.headers.get("Cookie"), null);
      assert.ok(new URL(forwarded.url).pathname.startsWith("/api/public/"));
    }
    const count = calls.length;
    for (const query of ["?screenId=bad", "?layout=wrong", "?tv=3", "?theme=wrong", "?tv=", "?tv=0&tv=1"]) assert.equal((await readCompatibleMonitor(request(query), reader)).status, 400);
    assert.equal((await readCompatibleMonitor(new Request("http://localhost/monitor", { headers: { Host: "other.test", "X-Forwarded-Host": "localhost" } }), reader)).status, 403);
    assert.equal(calls.length, count);
    const failed = await readCompatibleMonitor(request(""), async (_request, segments) => segments[0] === "settings" ? Response.json({ data: model.document }) : Response.json({ error: true }, { status: 503 }));
    assert.equal(failed.overview, null); assert.ok(failed.error);
    const mismatched = structuredClone(model.overview); mismatched.data.presentationRevision++;
    const outdated = await readCompatibleMonitor(request(""), async (_request, segments) => Response.json(segments[0] === "settings" ? { data: model.document } : mismatched));
    assert.equal(outdated.overview, null); assert.match(outdated.error, /apresentação mudou/);
    for (const malformed of [{}, { ...model.overview, data: null }, { ...model.overview, data: { ...model.overview.data, blocks: null } }, { ...model.overview, refreshAfterMs: -1 }]) {
      const invalid = await readCompatibleMonitor(request(""), async (_request, segments) => Response.json(segments[0] === "settings" ? { data: model.document } : malformed));
      assert.equal(invalid.overview, null); assert.match(invalid.error, /atualizar os dados/);
    }
  } finally {
    if (previous === undefined) delete process.env.PULSE_PUBLIC_HOSTS; else process.env.PULSE_PUBLIC_HOSTS = previous;
  }
});

test("compatible document contains rendered data without Next assets, escapes HTML and script data", () => {
  const model = fixture(), payload = '</script><img src=x onerror="alert(1)">&\u2028';
  model.screen.name = payload;
  const html = renderCompatiblePage(model, payload);
  assert.match(html, /Disponibilidade de Serviços/); assert.match(html, /Hosts monitorados/);
  assert.match(html, /monitor-compat\.css/); assert.match(html, /monitor-compat\.js/);
  assert.doesNotMatch(html, /\/_next\/|self\.__next_f|<img src=x/);
  const serialized = /<script id="compat-state" type="application\/json">([\s\S]*?)<\/script>/.exec(html)[1];
  assert.equal(JSON.parse(serialized).screens[0].name, payload);
  assert.doesNotMatch(serialized, /[<>&\u2028]/);
  model.error = "Coleta indisponível"; model.overview = null;
  assert.match(renderCompatibleContent(model), /Coleta indisponível/);
});

test("classic TV markup includes vector icons and volume even before scripts run", () => {
  for (const tv of [false, true]) {
    const model = fixture(); model.tv = tv;
    const html = renderCompatiblePage(model, "Pulse");
    assert.match(html, /id="compat-viewport">\s*<span id="compat-zoom-sensor" aria-hidden="true"><i id="compat-zoom-reference"><\/i><\/span>\s*<div id="compat-shell">/);
    assert.doesNotMatch(html, /▤|◇|∿|⚠|<use\b|@font-face/);
    assert.match(html, /class="panel-icon"[^>]*><svg\b/);
    assert.match(html, /class="kpi-heading"><h2>Hosts monitorados<\/h2><svg\b/);
    assert.match(html, /id="compat-tv"[^>]*><svg\b[^>]*data-icon="tv"/);
    assert.match(html, /id="compat-volume-on"><svg\b[^>]*data-icon="volume"/);
    assert.match(html, /id="compat-volume-off" hidden><svg\b[^>]*data-icon="volumeOff"/);
    assert.match(html, /type="range" id="compat-volume"[^>]*min="0"[^>]*max="100"[^>]*disabled/);
    assert.match(html, /id="compat-count" class="notification-count" aria-hidden="true" hidden/);
    assert.match(html, /class="panel-content" tabindex="0" role="region" aria-label="Conteúdo de /);
    for (const svg of html.matchAll(/<svg\b[^>]*>/g)) {
      assert.match(svg[0], /xmlns="http:\/\/www\.w3\.org\/2000\/svg"/);
      assert.match(svg[0], /width="\d+" height="\d+" viewBox="0 0 24 24"/);
      assert.match(svg[0], /stroke="currentColor"/);
    }
  }
});

test("each public block renders, retains per-block options, metric timestamps and read-only container policy", () => {
  for (const type of blockTypes) {
    const model = fixture(), source = model.overview.data, item = storage();
    const data = {
      summary: source.summary, highlighted_resources: { cards: [] }, asgard_summary: source.asgardSummary,
      problems: source.problems, resource_card: source.highlightedResources[0], host_inventory: [source.asgardSummary.host],
      container_inventory: [{ name: "private-container-canary" }], uptime_list: source.externalServices,
      signal_flow: { target: buildDemoSignalTargets()[0] }, storage_summary: { target: item },
    }[type];
    const block = { id: model.screen.blocks[0].id, type, enabled: true, width: "full", options: effectiveOptions({ type, ...(type === "storage_summary" ? { options: { storageConfigId: item.configId } } : {}) }) };
    model.screen.blocks = [block];
    model.overview.data.blocks = [{ ...model.overview.data.blocks[0], blockId: block.id, type, data }];
    const html = renderCompatibleContent(model);
    assert.doesNotMatch(html, /Bloco indisponível/, type);
    assert.doesNotMatch(html, /private-container-canary/, type);
    if (type === "storage_summary") {
      assert.match(html, /25%/); assert.match(html, /150 kbit\/s/); assert.match(html, /Volume 1/);
      model.overview.stale = true;
      assert.match(renderCompatibleContent(model), /Desatualizado/);
    }
  }
});

test("availability retains every card and configured disk reading, including Storage and Signal services", () => {
  const model = fixture(), item = storage(), block = model.screen.blocks.find(block => block.type === "highlighted_resources");
  const resource = structuredClone(model.overview.data.highlightedResources[0]);
  resource.config.presentation = { ...resource.config.presentation, showCpu: true, showMemory: false, showDisk: true };
  resource.metrics.diskUsagePercent = metric(52);
  const existing = model.overview.data.blocks.find(entry => entry.type === "highlighted_resources").data.cards.filter(card => card.kind !== "resource");
  const cards = [
    { kind: "resource", item: resource }, ...existing, { kind: "storage", item },
    { kind: "signal_service", item: { id: "service", displayName: "Redis configurado", servicePrefix: "stack_redis", kpiLabel: "No ar", tone: "good", cpu: 5, memory: 10, vmName: "VM 1", flowKpi: "redis", reason: "Estado informado" } },
  ];
  model.screen.blocks = [block]; model.overview.data.blocks = [{ ...model.overview.data.blocks[0], blockId: block.id, type: block.type, data: { cards } }];
  const html = renderCompatibleContent(model);
  assert.equal((html.match(/class="availability-card"/g) || []).length, cards.length);
  assert.match(html, /52%/); assert.match(html, /Redis configurado/); assert.match(html, /RX 150 kbit\/s/);
  assert.match(html, /content-sized/); assert.match(html, /max-height:130px/);
  const identities = markup => Object.fromEntries([...markup.matchAll(/data-open-detail="([^"]+)" aria-label="([^"]+)"/g)].map(match => [match[1], match[2]]));
  model.overview.data.blocks[0].data.cards.reverse();
  assert.deepEqual(identities(renderCompatibleContent(model)), identities(html));
  assert.ok(html.includes(`data-valid-until="${resource.metrics.diskUsagePercent.validUntil}"`));
});

test("classic browser assets remain parseable ES5 and avoid modern runtime dependencies", async () => {
  const files = ["monitor-compat.js", "monitor-compat-audio.js", "monitor-compat-bootstrap.js"];
  const forbidden = new Set(["ArrowFunction", "ClassDeclaration", "ClassExpression", "TemplateExpression", "NoSubstitutionTemplateLiteral", "AwaitExpression", "SpreadElement", "SpreadAssignment", "ForOfStatement", "QuestionDotToken", "QuestionQuestionToken", "QuestionQuestionEqualsToken", "BarBarEqualsToken", "AmpersandAmpersandEqualsToken", "AsteriskAsteriskToken", "AsyncKeyword"].map(name => ts.SyntaxKind[name]));
  for (const file of files) {
    const source = await readFile(new URL("../public/" + file, import.meta.url), "utf8");
    const tree = ts.createSourceFile(file, source, ts.ScriptTarget.ES5, true, ts.ScriptKind.JS);
    assert.equal(tree.parseDiagnostics.length, 0, file);
    function visit(node) {
      assert.equal(forbidden.has(node.kind), false, `${file}: ${ts.SyntaxKind[node.kind]}`);
      if (ts.isVariableDeclarationList(node)) assert.equal(node.flags & (ts.NodeFlags.Let | ts.NodeFlags.Const), 0, file);
      ts.forEachChild(node, visit);
    }
    visit(tree);
    assert.doesNotMatch(source, /\bfetch\s*\(|\bimport\s|\bIntl\.|\bResizeObserver\s*\(/);
  }
  const css = await readFile(new URL("../public/monitor-compat.css", import.meta.url), "utf8");
  assert.doesNotMatch(css, /oklch\(|color-mix\(|var\(|:has\(|@container|\bdvh\b/);
});
