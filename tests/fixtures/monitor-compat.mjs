import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { buildDemoHosts, buildDemoOverview, buildDemoPresentation, buildDemoSignalTargets } from "../../lib/server/monitoring/demo-data.ts";
import { resourceInputSchema } from "../../lib/config/resources.ts";
import { effectiveOptions, presentationDocumentSchema } from "../../lib/config/presentation.ts";
import { renderCompatibleContent, renderCompatiblePage, compatibleMonitorState } from "../../lib/server/monitor-compat/render.ts";

export function monitorFixture() {
  const now = Date.now(), at = new Date(now).toISOString();
  const metric = (value, unit = "percent") => ({ value, unit, quality: "fresh", observedAt: at, validUntil: new Date(now + 60000).toISOString() });
  const document = buildDemoPresentation().data;
  document.rotation.autoStart = false;
  const hosts = buildDemoHosts(), host = hosts.find(item => item.role === "linux") ?? hosts[0];
  const config = { ...resourceInputSchema.parse({ resourceType: "host", zabbixHostKey: host.hostKey, displayName: "VM configurada", presentation: { cardMetrics: ["cpu", "disk"] } }), id: randomUUID(), createdAt: at, updatedAt: at };
  const resource = { id: config.id, config, resource: host, resolved: true, resolution: "resolved", metrics: { cpuUsagePercent: metric(13), memoryUsagePercent: metric(72), diskUsagePercent: metric(51) }, cardDiskLabel: "Volumes configurados" };
  const storage = {
    configId: randomUUID(), storageKey: "storage-fixture", displayName: "Storage configurado", description: "Dados de teste", critical: true, dashboardEnabled: true,
    stale: false, presentationStatus: "ready", resolution: "resolved", monitoringEnabled: true, availability: "reachable", evidence: { observedAt: at, validUntil: new Date(now + 60000).toISOString() }, classification: { observedAt: at, validUntil: new Date(now + 60000).toISOString() },
    metrics: { cpuUsagePercent: metric(4), memoryUsagePercent: metric(8), ioWaitPercent: metric(0), uptimeSeconds: metric(1000, "seconds") },
    capacity: { coverage: "complete", label: "Volumes selecionados", filesystemKeys: ["root"], usedBytes: metric(250, "bytes"), totalBytes: metric(1000, "bytes"), availableBytes: metric(750, "bytes"), usagePercent: metric(25) },
    volumes: Array.from({ length: 16 }, (_, index) => ({ key: "volume-" + index, name: "Volume " + (index + 1), metrics: { diskUsagePercent: metric(25), diskUsedBytes: metric(250, "bytes"), diskTotalBytes: metric(1000, "bytes") }, availableBytes: metric(750, "bytes"), readOnly: metric(0, "count"), inodesFreePercent: metric(99) })),
    selectedInterface: { key: "network", name: "Interface selecionada", metrics: { networkReceiveBitsPerSecond: metric(150000, "bits/s"), networkTransmitBitsPerSecond: metric(50000, "bits/s") } },
  };
  const target = buildDemoSignalTargets()[0];
  const signalService = { id: randomUUID(), targetId: target.id, displayName: "Serviço configurado", servicePrefix: "stack_database", kpiLabel: "No ar", tone: "good", cpu: 7, memory: 22, disk: 63, cardMetrics: ["disk", "memory"], vmName: "VM vinculada", uptimeSeconds: 7200, flowKpi: "database", reason: "Em execução", enabled: true, dashboardEnabled: true, critical: true, displayOrder: 0 };
  const overview = buildDemoOverview(document.screens[0].id);
  const vm = overview.data.asgardSummary.vms[0];
  overview.data.asgardSummary.vms = Array.from({ length: 40 }, (_, index) => ({ ...vm, vmKey: "fixture-vm-" + index, name: "VM de teste " + (index + 1), displayName: "VM de teste " + (index + 1) }));
  const pool = [
    ["summary", overview.data.summary, "full"],
    ["highlighted_resources", { cards: [{ kind: "resource", item: resource }, { kind: "signal_service", item: signalService }, { kind: "storage", item: storage }, ...overview.data.externalServices.slice(0, 1).map(item => ({ kind: "external_service", item })), ...overview.data.standaloneVps.slice(0, 1).map(item => ({ kind: "standalone_vps", item })), ...overview.data.signalCards.slice(0, 1).map(item => ({ kind: "signal_target", item }))] }, "full"],
    ["asgard_summary", overview.data.asgardSummary, "standard"],
    ["signal_flow", { target }, "standard"],
    ["storage_summary", { target: storage }, "standard"],
  ];
  const blocks = pool.map(([type, , width]) => ({ id: randomUUID(), type, enabled: true, width, options: effectiveOptions({ type, ...(type === "storage_summary" ? { options: { storageConfigId: storage.configId } } : {}) }) }));
  document.screens[0] = { ...document.screens[0], blocks, layout: "overview", overviewGrid: "split" };
  overview.data.blocks = pool.map(([type, data], index) => ({ blockId: blocks[index].id, type, data, availability: "ready", stale: false, lastUpdated: at }));
  const validated = presentationDocumentSchema.parse(document);
  return { document: validated, screens: validated.screens, screen: validated.screens[0], overview, error: null, layout: "overview", tv: true, theme: "dark", now, refreshAfterMs: 5000 };
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const model = monitorFixture();
  if (process.argv[2]) model.document = presentationDocumentSchema.parse({ ...model.document, publicMonitorZoomPercent: Number(process.argv[2]), displayScalePercent: 125 });
  if (process.argv[3] !== undefined) {
    if (!['true', 'false'].includes(process.argv[3])) throw Error('Invalid scroll startup fixture');
    model.document.publicMonitorAutoScrollOnLoad = process.argv[3] === 'true';
  }
  process.stdout.write(JSON.stringify({ page: renderCompatiblePage(model, "Pulse de teste"), snapshot: { html: renderCompatibleContent(model), state: compatibleMonitorState(model) } }));
}
