import { effectiveOptions, type OptionsByType, type PresentationBlock } from "../../config/presentation.ts";
import { resolveAvailabilityPanel, type AvailabilityPanelCard } from "../../dashboard/availability-cards.ts";
import { selectProblems, selectVms, sortInventory } from "../../dashboard/block-options.ts";
import { storageLayout } from "../../dashboard/layout.ts";
import { metricValue, number, timestamp, isOld } from "../../dashboard/format.ts";
import { currentMetric, serviceAvailability } from "../../dashboard/service-availability.ts";
import { evidenceExpired } from "../../infrastructure/navigation.ts";
import type { AsgardSummary, ConfiguredResource, Host, Metric, OverviewBlock, ProbeCard, Problem, SignalFlowBlockData, Summary, VirtualMachine } from "../../monitoring/contracts.ts";
import { formatLatency, formatUptime, probeStatus, sortProbeCards } from "../../probe/status.ts";
import { signalStateLabel, signalStateTone, signalStateColor, signalWorkersLabel } from "../../signal/labels.ts";
import { storageStatus } from "../../storage/presentation.ts";
import type { StorageView } from "../../storage/contracts.ts";
import { publicVpsNetworkLabel, vpsMonitorLabel, vpsReasonColor, vpsStrip, vpsUptimeLabel } from "../../vps/labels.ts";
import type { CompatibleMonitor } from "./read.ts";
import { notificationMessages } from "../../notifications/contracts.ts";
import { mergeCardCpuRam, resolveCardCpuRam } from "../../monitoring/card-metrics.ts";
import { healthReasons, healthStates, resolutionLabel, severities } from "../../services/presentation.ts";

export function escapeMonitorHtml(value: unknown) {
  return String(value ?? "").replace(/[&<>"']/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]!);
}
const h = escapeMonitorHtml;
function stamp(value: string | null | undefined) { return value && Number.isFinite(Date.parse(value)) ? timestamp(value) : "Sem horário disponível"; }
function tone(value: string) { return ["good", "warn", "bad", "info", "unknown"].includes(value) ? value : "unknown"; }
function badge(label: string, state = "unknown") { return `<span class="status-pill tone-${tone(state)}" data-live-status><i class="status-dot"></i>${h(label)}</span>`; }
function heading(title: string, state = "", icon = "▤") { return `<div class="panel-heading"><span class="panel-icon" aria-hidden="true">${h(icon)}</span><h2>${h(title)}</h2>${state ? `<span class="service-separator" aria-hidden="true">•</span>${state}` : ""}</div>`; }
function panel(title: string, body: string, foot = "", state = "", icon = "▤") { return `<section class="dashboard-panel">${heading(title, state, icon)}<div class="panel-content">${body}</div>${foot ? `<footer class="panel-foot">${foot}</footer>` : ""}</section>`; }
function empty(text: string) { return `<p class="panel-empty">${h(text)}</p>`; }
function reading(label: string, metric: Metric | undefined, stale: boolean, now: number, series = "cpu") {
  const valid = currentMetric(metric, stale, now), old = isOld(metric, stale, now);
  const width = valid && metric?.unit === "percent" ? Math.min(100, Math.max(0, metric.value!)) : 0;
  return `<div class="reading${old ? " metric-old" : ""}" title="${h(old ? "Dado desatualizado · " : "")}${h(stamp(metric?.observedAt))}"><span>${h(label)}</span><strong>${h(metricValue(metric))}</strong><span class="metric-meter ${series}"><i style="width:${width}%"></i></span></div>`;
}
function rawMetric(label: string, metric: Metric | undefined, stale: boolean, now: number) { return `<div class="reading${isOld(metric, stale, now) ? " metric-old" : ""}"><span>${h(label)}</span><strong>${h(metricValue(metric))}</strong></div>`; }
function percent(label: string, value: number | null, series = "cpu") {
  const known = value !== null && Number.isFinite(value);
  return `<div class="reading"><span>${h(label)}</span><strong>${known ? h(number(value, 1)) + "%" : "Sem dados"}</strong><span class="metric-meter ${series}"><i style="width:${known ? Math.min(100, Math.max(0, value!)) : 0}%"></i></span></div>`;
}
function strip(values: number[], color = (value: number) => probeStatus(value < 0 ? null : value).color) {
  if (!values.length) return `<span class="strip empty-strip">Sem leituras</span>`;
  return `<span class="strip" aria-label="Histórico de disponibilidade">${values.map(value => `<i style="width:${100 / values.length}%;background:${h(color(value))}"></i>`).join("")}</span>`;
}
function table(headers: string[], rows: string[], visibleRows: number, label: string) {
  return `<div class="table-scroll" tabindex="0" role="region" aria-label="${h(label)}" style="max-height:${36 + 33 * visibleRows}px"><table><thead><tr>${headers.map(text => `<th>${h(text)}</th>`).join("")}</tr></thead><tbody>${rows.join("")}</tbody></table></div>`;
}
function cells(values: string[]) { return `<tr>${values.map(value => `<td>${value}</td>`).join("")}</tr>`; }
function hostState(host: Host | VirtualMachine, stale: boolean, now: number) {
  if (evidenceExpired(host, stale, now)) return badge("Desatualizado");
  if ("state" in host) return host.state === "running" ? badge("Em execução", "good") : host.state === "stopped" ? badge("Parada", "bad") : badge(host.state === "paused" ? "Pausada" : "Sem dados");
  return host.availability === "reachable" ? badge("Disponível", "good") : host.availability === "unreachable" ? badge("Indisponível", "bad") : badge("Sem dados");
}
function resourceReadings(item: ConfiguredResource, stale: boolean, now: number) {
  const p = item.config.presentation;
  return (p.showCpu ? reading("CPU", item.metrics.cpuUsagePercent, stale, now) : "")
    + (p.showMemory ? reading("RAM", item.metrics.memoryUsagePercent ?? item.metrics.memoryUsedBytes, stale, now, "memory") : "")
    + (p.showDisk ? reading("Disco", item.metrics.diskUsagePercent ?? item.metrics.diskUsedBytes, stale, now, "disk") : "");
}
function resourceDetail(item: ConfiguredResource, stale: boolean, now: number) {
  const p = item.config.presentation;
  const container = item.resource && "reference" in item.resource ? item.resource : null;
  const oldHealth = stale || !!container && "healthValidUntil" in container && (!container.healthValidUntil || Date.parse(container.healthValidUntil) < now);
  const health = container && "showHealth" in p && p.showHealth ? healthStates[oldHealth ? "unknown" : container.health] : null;
  const healthReason = container ? healthReasons[oldHealth ? "stale" : container.healthReason ?? "observed"] : "";
  const extra = (p.showMemory ? rawMetric("RAM usada", item.metrics.memoryUsedBytes, stale, now) + rawMetric("RAM total", item.metrics.memoryTotalBytes, stale, now) : "") + (p.showDisk ? rawMetric("Disco total", item.metrics.diskTotalBytes, stale, now) + rawMetric("Leitura de disco", item.metrics.diskReadBytesPerSecond, stale, now) + rawMetric("Escrita de disco", item.metrics.diskWriteBytesPerSecond, stale, now) : "");
  return `<p class="muted">${h(item.config.resourceType === "host" ? "Host" : "Container")}${item.config.critical ? " · Crítico para a operação" : ""} · ${h(item.config.zabbixHostKey)}</p>${!item.config.enabled ? `<p>Configuração desabilitada</p>` : ""}${!item.resolved ? `<p>${h(resolutionLabel(item))}</p>` : ""}${item.config.description ? `<p>${h(item.config.description)}</p>` : ""}${health ? `<p>${badge(health.label, health.tone)} ${h(healthReason)} · Health: ${h(stamp(container?.healthObservedAt))}</p>` : ""}<div class="metric-grid">${resourceReadings(item, stale, now)}${p.showNetwork ? rawMetric("RX", item.metrics.networkReceiveBitsPerSecond, stale, now) + rawMetric("TX", item.metrics.networkTransmitBitsPerSecond, stale, now) : ""}${p.showUptime ? rawMetric("Tempo ativo", item.metrics.uptimeSeconds, stale, now) : ""}</div>${extra ? `<div class="metric-grid storage-extra">${extra}</div>` : ""}<p class="muted">Leitura ${h(stamp(item.resource?.evidence.observedAt))}</p>`;
}
function cardFrame(id: string, title: string, description: string | null, state: string, content: string, footer: string, detail: string) {
  return `<div class="card-wrap"><button type="button" class="availability-card" data-open-detail="${h(id)}" aria-label="Detalhes de ${h(title)}">${state}<strong class="availability-name">${h(title)}</strong><span class="availability-description">${h(description)}</span><span class="availability-content">${content}</span><span class="availability-footer">${footer}</span></button><div id="${h(id)}" class="detail-source" data-detail-title="${h(title)}">${detail}</div></div>`;
}
function miniCard(card: AvailabilityPanelCard, index: number, blockId: string, stale: boolean, now: number): string {
  const id = `compat-detail-${blockId}-${index}`;
  switch (card.kind) {
    case "resource": {
      const item = card.item, status = serviceAvailability(item, stale, now);
      const title = item.config.displayName ?? item.resource?.displayName ?? item.resource?.name ?? item.config.zabbixHostKey;
      const footer = item.config.presentation.showUptime && currentMetric(item.metrics.uptimeSeconds, stale, now) ? `Ativo ${metricValue(item.metrics.uptimeSeconds)}` : `Leitura ${stamp(item.resource?.evidence.observedAt)}`;
      return cardFrame(id, title, item.config.description || item.linkedVmName || item.config.zabbixHostKey, badge(status.label, status.tone), `<span class="metric-grid">${resourceReadings(item, stale, now)}</span>`, `<span>${h(item.config.serviceType ?? "Host")}</span><strong>${h(footer)}</strong>`, resourceDetail(item, stale, now));
    }
    case "storage": {
      const item = card.item, status = storageStatus({ ...item, stale: stale || item.stale }, now), network = item.selectedInterface;
      return cardFrame(id, item.displayName, item.description ?? "Storage · Zabbix Agent", badge(status.label, status.tone), `<span class="metric-grid">${reading("CPU", item.metrics.cpuUsagePercent, stale || item.stale, now)}${reading("Disco", item.capacity.usagePercent, stale || item.stale, now, "disk")}</span>`, `<span>RX ${h(metricValue(network?.metrics.networkReceiveBitsPerSecond))}</span><strong>TX ${h(metricValue(network?.metrics.networkTransmitBitsPerSecond))}</strong>`, storagePanel(item, stale, now, 10));
    }
    case "external_service": {
      const item = card.item, status = item.paused ? { label: "Pausado", tone: "unknown" } : probeStatus(item.reason);
      return cardFrame(id, item.displayName, item.description || item.serviceType || "Aplicação", badge(status.label, status.tone), strip(item.paused ? [] : item.strip), `<span>${h(item.serviceType ?? "Aplicação")} · ${h(formatLatency(item.latencyMs))}</span><strong>${h(formatUptime(item.uptime24h))}</strong>`, `<p>${h(status.label)} · ${h(formatLatency(item.latencyMs))}</p><p>Disponibilidade: ${h(formatUptime(item.uptime24h))}</p>${strip(item.strip)}<p class="muted">Leitura ${h(stamp(item.checkedAt))}</p>`);
    }
    case "standalone_vps": {
      const item = card.item, status = item.enabled ? vpsMonitorLabel(item.monitorState) ?? { label: "Sem dados", tone: "unknown" } : { label: "Desabilitada", tone: "unknown" }, values = vpsStrip(item.enabled, item.monitorConfigured, item.strip, item.monitorPaused);
      return cardFrame(id, item.name, item.provider || publicVpsNetworkLabel, badge(status.label, status.tone), strip(values, vpsReasonColor), `<span>VPS · ${h(publicVpsNetworkLabel)}</span><strong>${h(vpsUptimeLabel(values))}</strong>`, `<div class="metric-grid">${percent("CPU", item.cpuPercent)}${percent("RAM", item.memoryPercent, "memory")}${percent("Disco", item.diskPercent, "disk")}</div><p class="muted">Leitura ${h(stamp(item.checkedAt))}</p>`);
    }
    case "signal_target": {
      const item = card.item;
      return cardFrame(id, item.displayName, item.description || "Signal health check", badge(item.enabled ? signalStateLabel(item.state) : "Pausado", item.enabled ? signalStateTone(item.state) : "unknown"), strip(item.enabled ? item.strip : [], signalStateColor), `<span>API · ${h(formatLatency(item.latencyMs))}</span><strong>${h(formatUptime(item.uptime24h))}</strong>`, `<p>${h(signalWorkersLabel(item.activeInstances, item.checkedAt))} · ${h(formatLatency(item.latencyMs))}</p>${strip(item.strip, signalStateColor)}<p class="muted">Leitura ${h(stamp(item.checkedAt))}</p>`);
    }
    case "signal_service": {
      const item = card.item;
      return cardFrame(id, item.displayName, item.servicePrefix, badge(item.kpiLabel, item.tone), `<span class="metric-grid">${percent("CPU", item.cpu)}${percent("RAM", item.memory, "memory")}</span>`, `<span>${h(item.vmName ?? "VM não associada")}</span><strong>${h(item.flowKpi === "database" ? "Banco" : item.flowKpi === "redis" ? "Redis" : "Serviço")}</strong>`, `<p>${h(item.reason)}</p><div class="metric-grid">${percent("CPU", item.cpu)}${percent("RAM", item.memory, "memory")}</div>`);
    }
  }
}
function summaryBlock(data: Summary, options: OptionsByType["summary"], stale: boolean) {
  const catalog = {
    hosts: { label: "Hosts monitorados", value: data.hostsKnown, note: `${number(data.hostsReachable)} alcançáveis · ${number(data.vms)} VMs no hipervisor` },
    containers_running: { label: "Containers em execução", value: data.containersRunning, note: `${number(data.containersTotal)} containers no total` },
    containers_stopped: { label: "Containers parados", value: data.containersStopped, note: "Total informado pela origem" },
    problems: { label: "Problemas ativos", value: data.problems, note: `${number(data.criticalAffected)} recursos críticos afetados` },
    jobs_waiting: { label: "Jobs aguardando", value: data.jobsWaiting, note: data.jobsWaitingOldestSeconds == null ? "Sem idade informada" : `Mais antigo: ${metricValue({ value: data.jobsWaitingOldestSeconds, unit: "seconds", quality: "fresh", observedAt: null })}` },
  };
  return `<div class="dashboard-kpis">${options.indicators.map(key => { const item = catalog[key]; return `<article class="dashboard-kpi"><h2>${h(item.label)}</h2><p class="kpi-value">${h(number(item.value))}</p><p>${h(stale ? "Dados desatualizados · " : "")}${h(item.note)}</p></article>`; }).join("")}</div>`;
}
function asgardPanel(data: AsgardSummary, block: PresentationBlock, stale: boolean, now: number) {
  const options = effectiveOptions({ ...block, type: "asgard_summary" }), host = data.host;
  if (!host) return panel("ASGARD · armazenamento & VMs", empty("Sem dados do hipervisor na coleta atual."));
  const vms = selectVms(data.vms, options, stale, now);
  const hasDisk = data.vms.some(vm => vm.metrics.diskUsagePercent || vm.metrics.diskUsedBytes || vm.metrics.diskTotalBytes);
  const metrics = `<div class="metric-grid asgard-metrics">${reading("CPU", host.metrics.cpuUsagePercent, stale, now)}${reading("RAM", host.metrics.memoryUsagePercent ?? host.metrics.memoryUsedBytes, stale, now, "memory")}${host.storages.map(storage => reading(storage.name, storage.metrics.diskUsagePercent ?? storage.metrics.diskUsedBytes, stale, now, "disk")).join("")}</div>`;
  const rows = vms.map(vm => cells([`<strong>${h(vm.displayName ?? vm.name)}</strong>`, hostState(vm, stale, now), reading("", vm.metrics.cpuUsagePercent, stale, now), reading("", vm.metrics.memoryUsagePercent ?? vm.metrics.memoryUsedBytes, stale, now, "memory"), ...(hasDisk ? [reading("", vm.metrics.diskUsagePercent ?? vm.metrics.diskUsedBytes, stale, now, "disk")] : [])]));
  return panel(`${host.displayName ?? host.name} · armazenamento & VMs`, metrics + (rows.length ? table(["VM no Asgard", "Estado", "CPU", "RAM", ...(hasDisk ? ["Disco · hipervisor"] : [])], rows, options.visibleRows, "VMs dentro de ASGARD") : empty("Nenhuma VM corresponde ao filtro.")), `<span class="metric-legend"><span class="cpu">CPU</span><span class="memory">RAM</span><span class="disk">Disco</span></span><span>${number(data.vms.filter(vm => vm.state === "running" && !evidenceExpired(vm, stale, now)).length)} em execução de ${number(data.vms.length)} VMs</span>`, hostState(host, stale, now));
}
function storagePanel(item: StorageView | null, stale: boolean, now: number, visibleRows: number): string {
  if (!item) return panel("Storage", empty("Nenhum Storage disponível para esta configuração."));
  const old = stale || item.stale, status = storageStatus({ ...item, stale: old }, now), network = item.selectedInterface;
  const body = `<p class="muted storage-description">${h(item.description ?? "Storage")}</p><div class="metric-grid">${reading("CPU", item.metrics.cpuUsagePercent, old, now)}${reading("RAM", item.metrics.memoryUsagePercent, old, now, "memory")}${reading("Disco ocupado", item.capacity.usagePercent, old, now, "disk")}</div><div class="metric-grid storage-extra">${rawMetric("Usado", item.capacity.usedBytes, old, now)}${rawMetric("Total", item.capacity.totalBytes, old, now)}${rawMetric("Disponível", item.capacity.availableBytes, old, now)}${rawMetric("Tempo ativo", item.metrics.uptimeSeconds, old, now)}${rawMetric("Espera por I/O", item.metrics.ioWaitPercent, old, now)}</div>`;
  const rows = item.volumes.map(volume => cells([h(volume.name), reading("", volume.metrics.diskUsagePercent, old, now, "disk"), `${h(metricValue(volume.metrics.diskUsedBytes))} / ${h(metricValue(volume.metrics.diskTotalBytes))}`, h(metricValue(volume.availableBytes)), h(metricValue(volume.inodesFreePercent)), volume.readOnly?.value == null ? "Sem dados" : volume.readOnly.value ? "Somente leitura" : "Leitura e escrita"]));
  const traffic = network ? `<p class="storage-traffic">${h(network.name)} · RX ${h(metricValue(network.metrics.networkReceiveBitsPerSecond))} · TX ${h(metricValue(network.metrics.networkTransmitBitsPerSecond))}</p>` : "";
  return panel(item.displayName, body + table(["Volume", "Ocupado", "Usado / total", "Disponível", "Inodes livres", "Acesso"], rows, visibleRows, "Volumes do Storage") + traffic, `<span>${h(item.capacity.label)}</span><span>Leitura ${h(stamp(item.evidence.observedAt))}</span>`, badge(status.label, status.tone), "▤");
}
function signalPanel(data: SignalFlowBlockData, visibleRows: number) {
  const target = data.target;
  if (!target) return panel("Signal · fluxo de processamento", empty("Nenhum alvo Softcom Signal habilitado."), "", "", "∿");
  const knowledge = target.checks?.knowledgeIndex;
  const jobs = knowledge && typeof knowledge === "object" && !Array.isArray(knowledge) ? knowledge as Record<string, unknown> : {};
  const count = (value: unknown) => typeof value === "number" && Number.isFinite(value) ? number(value) : "—";
  const boxes = [["Em fila", jobs.jobsQueued], ["Rodando", jobs.jobsRunning], ["Pendentes", jobs.itemsPending]];
  const stats = `<div class="signal-jobs">${boxes.map(([label, value]) => `<div><strong>${h(count(value))}</strong><span>${h(label)}</span></div>`).join("")}${(target.flowKpis ?? []).map(item => `<div><strong class="tone-${tone(item.tone)}">${h(item.kpiLabel)}</strong><span>${h(item.displayName)}</span></div>`).join("")}</div>`;
  const pending = [["Saída · outbox na fila", target.outboxPending], ["Entrada · inbox na fila", target.inboxPending], ["Dead letter", target.outboxDead == null && target.inboxDead == null ? null : (target.outboxDead ?? 0) + (target.inboxDead ?? 0)]] as const;
  return panel("Signal · fluxo de processamento", stats + `<p class="muted">${h(signalWorkersLabel(target.activeInstances, target.checkedAt))} · ${h(formatLatency(target.latencyMs))}</p>` + strip(target.strip, signalStateColor) + table(["Pipeline", "Quantidade"], pending.map(([label, value]) => cells([h(label), h(number(value))])), visibleRows, "Pipeline Signal"), `<span>${h(target.displayName)}</span><span>Leitura ${h(stamp(target.checkedAt))}</span>`, badge(signalStateLabel(target.state), signalStateTone(target.state)), "∿");
}
function renderBlock(model: CompatibleMonitor, configuration: PresentationBlock) {
  const payload = model.overview?.data.blocks.find(block => block.blockId === configuration.id && block.type === configuration.type);
  const stale = !!model.overview?.stale || !!payload?.stale, now = model.now;
  if (configuration.type === "container_inventory") return panel("Containers descobertos", empty("O inventário de containers só está disponível para usuários logados."));
  if (!payload || payload.data === null || payload.availability === "unavailable") return panel("Bloco indisponível", empty(model.error ?? "Este bloco não está disponível na coleta atual."));
  const block = { ...payload, options: configuration.options } as OverviewBlock;
  switch (configuration.type) {
    case "summary": return summaryBlock(block.data as Summary, effectiveOptions({ ...configuration, type: "summary" }), stale);
    case "highlighted_resources": {
      const options = effectiveOptions({ ...configuration, type: "highlighted_resources" });
      const resolved = resolveAvailabilityPanel(block.data, options, { probes: model.overview?.data.externalServices ?? [], vps: model.overview?.data.standaloneVps ?? [], signalCards: model.overview?.data.signalCards ?? [] });
      const cards = resolved.cards;
      const split = model.layout === "overview" && model.screen.overviewGrid === "split";
      const visibleRows = split ? Math.max(2, options.visibleRows) : options.visibleRows;
      return panel("Disponibilidade de Serviços", cards.length ? `<div class="availability-grid" tabindex="0" role="region" aria-label="Recursos destacados" style="max-height:${visibleRows * 128 + 2}px">${cards.map((card, index) => miniCard(card, index, configuration.id, stale, now)).join("")}</div>` : empty("Nenhum serviço corresponde à seleção deste bloco."), "Estado do recurso · CPU / RAM na infraestrutura · latência nas aplicações · faixa Signal/VPS", "", "◇");
    }
    case "asgard_summary": return asgardPanel(block.data as AsgardSummary, configuration, stale, now);
    case "storage_summary": return storagePanel((block.data as { target: StorageView | null }).target, stale, now, effectiveOptions({ ...configuration, type: "storage_summary" }).visibleRows);
    case "signal_flow": return signalPanel(block.data as SignalFlowBlockData, effectiveOptions({ ...configuration, type: "signal_flow" }).visibleRows);
    case "resource_card": {
      const item = block.data as ConfiguredResource, status = serviceAvailability(item, stale, now);
      return panel(item.config.displayName ?? item.resource?.displayName ?? item.resource?.name ?? item.config.zabbixHostKey, resourceDetail(item, stale, now), "", item.config.presentation.showStatus ? badge(status.label, status.tone) : "");
    }
    case "problems": {
      const options = effectiveOptions({ ...configuration, type: "problems" });
      const problems = selectProblems(block.data as Problem[], options);
      const rows = problems.map(problem => cells([badge(severities[problem.severity].label, severities[problem.severity].tone), `<strong>${h(problem.displayDescription ?? problem.description)}</strong><small>${h(problem.resourceDisplayName ?? problem.resource.hostKey)}</small>`, h(stamp(problem.startedAt))]));
      return panel("Problemas ativos", rows.length ? table(["Severidade", "Problema", "Desde"], rows, options.visibleRows, "Problemas ativos") : empty("Nenhum problema ativo corresponde ao filtro."), `Última atualização: ${h(stamp(block.lastUpdated))}`, "", "⚠");
    }
    case "host_inventory": {
      const options = effectiveOptions({ ...configuration, type: "host_inventory" });
      const hosts = sortInventory(block.data as Host[], options, stale, now);
      const cards = hosts.map(host => {
        const resolved = resolveCardCpuRam(host, block.data as Host[], model.overview?.data.hostMetricsSources?.[host.hostKey] ?? "hypervisor");
        const metrics = mergeCardCpuRam(host.metrics, resolved.metrics);
        return `<article class="host-card">${heading(host.displayName ?? host.name, hostState(host, stale, now))}<p class="muted">${h(host.role === "hypervisor" ? "Hipervisor · Zabbix" : resolved.source === "agent" ? "Linux · Agent" : "Linux · igual à listagem")}</p><div class="metric-grid">${reading("CPU", metrics.cpuUsagePercent, stale, now)}${reading("RAM", metrics.memoryUsagePercent ?? metrics.memoryUsedBytes, stale, now, "memory")}${rawMetric("Tempo ativo", host.metrics.uptimeSeconds, stale, now)}</div><small>Leitura ${h(stamp(host.evidence.observedAt))}</small></article>`;
      });
      return panel("Hosts monitorados", cards.length ? `<div class="host-card-grid" tabindex="0" role="region" aria-label="Hosts monitorados" style="max-height:${options.visibleRows * 100}px">${cards.join("")}</div>` : empty("Nenhum host disponível."), "CPU/RAM do card: padrão = listagem de VMs · Agent opcional em Recursos.");
    }
    case "uptime_list": {
      const options = effectiveOptions({ ...configuration, type: "uptime_list" });
      const items = sortProbeCards(block.data as ProbeCard[], options.sortBy, options.sortDirection);
      const rows = items.map(item => cells([h(item.displayName), badge(item.paused ? "Pausado" : probeStatus(item.reason).label, item.paused ? "unknown" : probeStatus(item.reason).tone), h(formatLatency(item.latencyMs)), strip(item.paused ? [] : item.strip), h(formatUptime(item.uptime24h))]));
      return panel("Uptime das aplicações", rows.length ? table(["Aplicação", "Estado", "Latência", "Histórico", "Disponibilidade"], rows, options.visibleRows, "Uptime das aplicações") : empty("Nenhuma aplicação disponível."));
    }
  }
  return panel("Bloco indisponível", empty("Este bloco não está disponível nesta superfície."));
}

export function renderCompatibleContent(model: CompatibleMonitor) {
  const composition = storageLayout(model.screen.blocks, model.layout === "overview" && model.screen.overviewGrid === "split", model.layout === "wall");
  const enabled = model.screen.blocks.filter(block => block.enabled);
  const gridTypes = ["highlighted_resources", "problems", "asgard_summary", "signal_flow"];
  const legacySplit = model.layout === "overview" && model.screen.overviewGrid === "split" && !enabled.some(block => block.type === "storage_summary");
  if (legacySplit && gridTypes.every(type => enabled.filter(block => block.type === type).length <= 1)) {
    const find = (type: string) => enabled.find(block => block.type === type);
    const availability = find("highlighted_resources"), problems = find("problems"), asgard = find("asgard_summary"), signal = find("signal_flow");
    const rows: typeof composition.rows = [];
    function addRow(blocks: { block: PresentationBlock; span: number }[], minimum: number, paired: boolean) {
      if (blocks.length) rows.push({ blocks, minimum, paired, contentSized: blocks.every(item => item.block.type === "highlighted_resources") });
    }
    // The original non-Storage split has a 1.25 : 1 ratio. Preserve it without CSS Grid.
    const left = 12 * 5 / 9, right = 12 * 4 / 9, side = problems ?? signal;
    addRow([...(availability ? [{ block: availability, span: left }] : []), ...(side ? [{ block: side, span: right }] : [])], availability ? 90 + 120 * Math.max(2, effectiveOptions({ ...availability, type: "highlighted_resources" }).visibleRows) : 210, true);
    addRow([...(asgard ? [{ block: asgard, span: problems ? left : 12 }] : []), ...(problems && signal ? [{ block: signal, span: right }] : [])], 210, false);
    for (const block of enabled.filter(block => block.type !== "summary" && !gridTypes.includes(block.type))) addRow([{ block, span: 12 }], 210, false);
    composition.rows = rows;
  }
  for (const row of composition.rows) {
    const availability = row.paired && row.blocks.find(item => item.block.type === "highlighted_resources")?.block;
    if (availability) row.minimum = Math.max(row.minimum, 90 + 120 * Math.max(2, effectiveOptions({ ...availability, type: "highlighted_resources" }).visibleRows));
  }
  const summaries = composition.summaries.map(block => `<div class="compat-summary">${renderBlock(model, block)}</div>`).join("");
  const rows = composition.rows.map(row => `<div class="compat-row${row.contentSized ? " content-sized" : ""}${row.paired ? " split-row" : ""}" data-min-height="${row.minimum}">${row.blocks.map(({ block, span }) => `<div class="compat-cell block-${block.type}" style="width:${span / 12 * 100}%" data-block-id="${h(block.id)}">${renderBlock(model, block)}</div>`).join("")}</div>`).join("");
  const old = model.error || model.overview?.stale;
  return `<div class="compat-evidence${old ? " is-stale" : ""}" data-updated-at="${h(model.overview?.lastUpdated)}">${old ? `<p class="compat-warning" role="alert">${h(model.error ?? "Dados desatualizados. Confira o horário de cada leitura.")}</p>` : ""}${model.document.showStatusBanner ? `<p class="monitor-status">${h(model.overview?.availability === "ready" ? "Monitoramento atualizado" : "Aguardando dados do monitoramento")} · ${h(stamp(model.overview?.lastUpdated))}</p>` : ""}${summaries}<div class="dashboard-blocks" aria-busy="false">${rows}</div><footer class="dashboard-footer"><span><i class="status-dot tone-good"></i>Disponível · <i class="status-dot tone-warn"></i>Atenção · <i class="status-dot tone-bad"></i>Indisponível · <i class="status-dot tone-unknown"></i>Desconhecido / sem dados</span><span>Horários de Fortaleza · UTC−3 · Leitura ${h(stamp(model.overview?.lastUpdated))}</span></footer></div>`;
}

export function compatibleMonitorState(model: CompatibleMonitor) {
  return { screenId: model.screen.id, screens: model.screens.map(screen => ({ id: screen.id, name: screen.name })), revision: model.document.revision, layout: model.layout, tv: model.tv, theme: model.theme, scale: model.document.displayScalePercent, autoStart: model.document.rotation.autoStart, intervalMs: model.document.rotation.intervalSeconds * 1000, refreshAfterMs: model.refreshAfterMs, serverTime: new Date(model.now).toISOString(), messages: notificationMessages };
}
function scriptData(value: unknown) { return JSON.stringify(value).replace(/[<>&\u2028\u2029]/g, character => "\\u" + character.charCodeAt(0).toString(16).padStart(4, "0")); }

export function renderCompatiblePage(model: CompatibleMonitor, appName: string) {
  const state = compatibleMonitorState(model);
  return `<!doctype html>
<html lang="pt-BR" class="${model.theme}">
<head>
  <meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="theme-color" content="#191919"><title>${h(appName)}</title>
  <link rel="icon" href="/favicon.ico"><link rel="stylesheet" href="/monitor-compat.css">
  <noscript><meta http-equiv="refresh" content="${Math.ceil(model.refreshAfterMs / 1000)}"></noscript>
</head>
<body class="${model.tv ? "tv-mode" : ""}">
<div id="compat-shell">
  <a class="skip-link" href="#main">Ir para o conteúdo</a>
  <header class="pulse-topbar">
    <div class="pulse-brand"><span class="pulse-brand-mark" aria-hidden="true"><svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12h4l3-9 4 18 3-9h4"/></svg></span><strong>${h(appName)}</strong></div>
    <span class="brand-caption">Central de monitoramento</span>
    <div class="top-actions">
      <span class="clock"><strong id="compat-clock">${h(stamp(new Date(model.now).toISOString()).split(", ").pop())}</strong><small>FORTALEZA · UTC−3</small></span>
      <a id="compat-tv" class="control" href="/monitor?compat=1&amp;tv=${model.tv ? "0" : "1"}" aria-pressed="${model.tv}">${model.tv ? "Sair do modo TV" : "Modo TV"}</a>
      <button class="control" id="compat-fullscreen" type="button">Tela cheia</button>
      <button class="control" id="compat-notifications" type="button" aria-label="Notificações"><svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4"/></svg> <span id="compat-count">—</span></button>
    </div>
  </header>
  <main id="main">
    <div class="presentation-toolbar">
      <h1>Toda a operação. Um só lugar.</h1>
      <div class="presentation-controls">
        <a class="control layout-control" href="/monitor?compat=1&amp;layout=overview" data-layout="overview">1 · Visão geral</a>
        <a class="control layout-control" href="/monitor?compat=1&amp;layout=wall" data-layout="wall">2 · Tela completa</a>
        <button class="control" id="compat-rotate" type="button">${model.document.rotation.autoStart ? "Parar alternância" : "Alternar telas"}</button>
        <label for="compat-screen" class="sr-only">Tela</label>
        <select id="compat-screen" class="control">${model.screens.map(screen => `<option value="${h(screen.id)}"${screen.id === model.screen.id ? " selected" : ""}>${h(screen.name)}</option>`).join("")}</select>
        <a id="compat-refresh" class="control" href="/monitor?compat=1">Atualizar</a>
      </div>
    </div>
    <p id="compat-status" class="compat-warning" role="status" hidden></p>
    <div id="compat-content">${renderCompatibleContent(model)}</div>
  </main>
</div>
<div id="compat-modal" class="compat-modal" role="dialog" aria-modal="true" aria-labelledby="compat-modal-title" hidden>
  <div class="modal-backdrop" data-close-modal></div>
  <section class="modal-panel"><header><h2 id="compat-modal-title">Detalhes</h2><button type="button" class="control" data-close-modal aria-label="Fechar">×</button></header><div id="compat-modal-body"></div></section>
</div>
<button type="button" id="compat-toast" class="compat-toast" hidden></button>
<div id="compat-announcement" class="sr-only" role="status" aria-live="polite"></div>
<script id="compat-state" type="application/json">${scriptData(state)}</script>
<script src="/monitor-compat.js" defer></script>
</body></html>`;
}

export function renderCompatibleFailure(message: string, appName: string) {
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="refresh" content="20"><title>${h(appName)}</title><link rel="stylesheet" href="/monitor-compat.css"></head><body><main><h1>${h(appName)}</h1><section class="dashboard-panel"><h2>Não foi possível carregar o monitoramento</h2><p>${h(message)}</p><p>A atualização será tentada novamente em 20 segundos.</p><a class="control" href="/monitor?compat=1">Tentar novamente</a></section></main></body></html>`;
}
