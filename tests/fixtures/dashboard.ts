import { defaultDashboardBlocks, type PresentationDocument } from "../../lib/config/presentation";
import type { ConfiguredResource, Host, Metric, Overview, Problem, ReadResult, Summary } from "../../lib/monitoring/contracts";

export const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
export function presentation(count = 1, revision = 1, autoStart = false): PresentationDocument {
  return { schemaVersion: 1, revision, defaultTvMode: false, displayScalePercent: 110, idlePresentation: { enabled: false, afterMinutes: 5, requestFullscreen: true }, rotation: { intervalSeconds: 5, autoStart }, screens: Array.from({ length: count }, (_, index) => ({ id: id(index + 1), name: ["Visão geral", "Operação", "Infraestrutura"][index], enabled: true, layout: index === 1 ? "wall" : "overview", blocks: defaultDashboardBlocks.map((block, position) => ({ id: id(100 + index * 10 + position), ...block, enabled: true })) })) };
}
export function overview(document: PresentationDocument, screenId = document.screens[0].id, stale = false): ReadResult<Overview> {
  const observedAt = new Date().toISOString();
  const metric = (value: number | null, unit: Metric["unit"] = "percent"): Metric => ({ value, unit, observedAt: value === null ? null : observedAt, quality: value === null ? "missing" : stale ? "stale" : "fresh", validUntil: new Date(Date.now() + 3600000).toISOString() });
  const evidence = { source: "zabbix" as const, observedAt, basis: "item" as const, validUntil: new Date(Date.now() + 3600000).toISOString() };
  const host: Host = { hostKey: "ASGARD", name: "ASGARD", role: "hypervisor", availability: "reachable", evidence,
    metrics: { cpuUsagePercent: metric(12.5), memoryUsagePercent: metric(45.8) },
    storages: [{ key: "storage-1", name: "local-zfs", metrics: { diskUsagePercent: metric(39), diskUsedBytes: metric(400 * 1024 ** 3, "bytes"), diskTotalBytes: metric(1024 ** 4, "bytes") } }], filesystems: [], interfaces: [],
    vms: Array.from({ length: 16 }, (_, index) => ({ vmKey: `vm-${index}`, vmId: String(100 + index), name: index === 0 ? "vm-nome-muito-longo-para-validar-quebra-de-linha-sem-cortar-informacao" : `vm-operacao-${index}`, parentHostKey: "ASGARD", state: "running", linuxHostKey: index === 0 ? "linux-operacao" : null, metrics: { cpuUsagePercent: metric(index), memoryUsedBytes: metric(2 * 1024 ** 3, "bytes"), uptimeSeconds: metric(90000, "seconds") }, evidence })) };
  const resource: ConfiguredResource = { id: id(90), resolved: true, resolution: "resolved", resource: host, metrics: { cpuUsagePercent: metric(0), memoryUsedBytes: metric(null, "bytes") }, config: { id: id(90), resourceType: "host", source: "zabbix", zabbixHostKey: "ASGARD", selectorType: null, selectorValue: null, displayName: "Aplicação monitorada", description: null, serviceType: null, dashboardEnabled: true, critical: true, displayOrder: 0, presentation: { showStatus: true, showCpu: true, showMemory: true, showDisk: false, showNetwork: false, showUptime: false }, enabled: true, createdAt: observedAt, updatedAt: observedAt } };
  const summary: Summary = { hostsKnown: 2, hostsReachable: 2, vms: 16, containersRunning: 5, containersStopped: 1, containersTotal: 6, problems: 1, criticalAffected: 0 };
  const problems: Problem[] = [{ id: "problem-1", resource: { type: "host", hostKey: "ASGARD", reference: null }, description: "Atenção na coleta da unidade", severity: 2, visualState: "warning", startedAt: observedAt }];
  const asgardSummary = { host, vms: host.vms };
  const screen = document.screens.find(screen => screen.id === screenId)!;
  return { availability: "ready", stale, lastUpdated: observedAt, refreshAfterMs: 20000, data: { screenId, presentationRevision: document.revision, summary, highlightedResources: [resource], problems, asgardSummary,
    blocks: screen.blocks.filter(block => block.enabled).map(block => ({ blockId: block.id, type: block.type, availability: "ready", stale, lastUpdated: observedAt, data: block.type === "summary" ? summary : block.type === "highlighted_resources" ? [resource] : block.type === "resource_card" ? resource : block.type === "problems" ? problems : block.type === "host_inventory" ? [host] : asgardSummary })) } };
}
