import { PlaceLink } from "@/components/layout/place-link";
import { Activity, ArrowRight, Box, Layers, Server, TriangleAlert } from "lucide-react";
import { useContext, type CSSProperties, type ReactNode } from "react";
import { effectiveOptions, type IndicatorKey, type OptionsByType } from "@/lib/config/presentation";
import { selectHighlights, selectProblems, sortInventory } from "@/lib/dashboard/block-options";
import { EvidenceTimeContext } from "./metrics";
import type { AsgardSummary, ConfiguredResource, Container, Host, OverviewBlock, ProbeCard, Problem, SignalFlowBlockData, Summary } from "@/lib/monitoring/contracts";
import { HostInventory } from "@/components/infrastructure/host-panels";
import { number, timestamp } from "@/lib/dashboard/format";
import { SeverityPill } from "@/components/services/states";
import { ContainerInventory } from "@/components/services/container-inventory";
import { AsgardPanel } from "./asgard-panel";
import { ResourceCard } from "./resource-card";
import { ServiceAvailabilityCard } from "./service-availability-card";
import { ProbeAvailabilityCard } from "./probe-card";
import { VpsAvailabilityCard } from "./vps-card";
import { SignalAvailabilityCard } from "./signal-card";
import { SignalFlowPanel } from "./signal-flow";
import type { StandaloneVpsHighlight } from "@/lib/config/standalone-vps";
import { UptimeList } from "./uptime-list";
import "./availability.css";
import "./signal-flow.css";

function Panel({ title, icon, children, note, rows }: { title: string; icon: ReactNode; children: ReactNode; note?: string; rows?: number }) {
  return <section className="dashboard-panel configured-panel" style={rows ? { "--visible-rows": rows } as CSSProperties : undefined}><div className="panel-heading">{icon}<h2>{title}</h2></div>{children}{note && <p className="panel-foot">{note}</p>}</section>;
}

function formatOldest(seconds: number | null | undefined) {
  if (seconds == null) return "Sem idade informada";
  if (seconds < 60) return `Mais antigo: ${seconds} s`;
  if (seconds < 3600) {
    const minutes = Math.floor(seconds / 60);
    const rest = seconds % 60;
    return rest ? `Mais antigo: ${minutes} min ${rest} s` : `Mais antigo: ${minutes} min`;
  }
  return `Mais antigo: ${Math.floor(seconds / 3600)} h`;
}

function SummaryBlock({ data, stale, options }: { data: Summary; stale: boolean; options: OptionsByType["summary"] }) {
  const catalog: Record<IndicatorKey, { label: string; value: number | null; icon: ReactNode; note: string; warn?: boolean; unit?: string }> = {
    hosts: {
      label: "Hosts monitorados", value: data.hostsKnown, icon: <Server />,
      note: `${number(data.hostsReachable)} alcançáveis · ${number(data.vms)} VMs no hipervisor`,
    },
    containers_running: {
      label: "Containers em execução", value: data.containersRunning, icon: <Box />,
      note: `${number(data.containersTotal)} containers no total`,
    },
    containers_stopped: {
      label: "Containers parados", value: data.containersStopped, icon: <Layers />,
      note: "Total informado pela origem",
    },
    problems: {
      label: "Problemas ativos", value: data.problems, icon: <TriangleAlert />,
      note: `${number(data.criticalAffected)} recursos críticos afetados`,
    },
    jobs_waiting: {
      label: "Jobs aguardando",
      value: data.jobsWaiting ?? null,
      icon: <Activity />,
      note: data.jobsWaiting == null && data.jobsWaitingOldestSeconds == null
        ? "Sem alvo Signal"
        : formatOldest(data.jobsWaitingOldestSeconds),
      warn: (data.jobsWaiting ?? 0) > 0,
      unit: "jobs",
    },
  };
  return <section className={`dashboard-kpis ${stale ? "is-stale" : ""}`} aria-label="Indicadores da operação">{options.indicators.map(key => {
    const item = catalog[key];
    const jobsFoot = key === "jobs_waiting"
      ? item.value === null ? item.note : stale ? "Dados desatualizados" : item.note
      : item.value === null ? "Sem dados da origem" : stale ? "Dados desatualizados" : item.note;
    return <article className="dashboard-kpi" key={key}>
      <div className="kpi-label"><h2>{item.label}</h2><span aria-hidden="true">{item.icon}</span></div>
      <p className={`kpi-value${item.warn && !stale && item.value != null ? " tone-warn" : ""}`}>
        {number(item.value)}{item.unit && item.value != null ? <small> {item.unit}</small> : null}
      </p>
      <p className={key === "jobs_waiting" && item.value != null && !stale ? (item.warn ? "tone-warn" : "tone-good") : undefined}>
        {key === "jobs_waiting" && item.value != null && !stale && <i className="status-dot" />}{jobsFoot}
      </p>
      {stale && key !== "jobs_waiting" && <p>{item.note}</p>}
    </article>;
  })}</section>;
}
export function DashboardBlock({ block, failed, probes = [], vps = [], signalCards = [], hostMetricsSources }: {
  block: OverviewBlock; failed: boolean; probes?: ProbeCard[]; vps?: StandaloneVpsHighlight[];
  signalCards?: NonNullable<import("@/lib/monitoring/contracts").Overview["signalCards"]>;
  hostMetricsSources?: Record<string, "auto" | "agent" | "hypervisor">;
}) {
  const stale = failed || block.stale, now = useContext(EvidenceTimeContext);
  if (block.type === "signal_flow") {
    if (block.availability === "unavailable") return <Panel title="Signal · fluxo de processamento" icon={<TriangleAlert aria-hidden="true" />}><p className="panel-empty">Este bloco não está disponível nesta superfície.</p></Panel>;
    return <SignalFlowPanel data={(block.data as SignalFlowBlockData | null) ?? { target: null }} options={effectiveOptions({ ...block, type: "signal_flow" })} />;
  }
  if (block.availability === "unavailable" || block.data === null) return <Panel title="Bloco indisponível" icon={<TriangleAlert aria-hidden="true" />}><p className="panel-empty">Este bloco não está disponível na configuração atual.</p></Panel>;
  switch (block.type) {
    case "summary": return <SummaryBlock data={block.data as Summary} stale={stale} options={effectiveOptions({ ...block, type: "summary" })} />;
    case "asgard_summary": return <AsgardPanel data={block.data as AsgardSummary} stale={stale} options={effectiveOptions({ ...block, type: "asgard_summary" })} />;
    case "host_inventory": {
      const options = effectiveOptions({ ...block, type: "host_inventory" });
      return <HostInventory hosts={sortInventory(block.data as Host[], options, stale, now)} inventoryHosts={block.data as Host[]} stale={stale} compact visibleRows={options.visibleRows} metricsSources={hostMetricsSources} />;
    }
    case "container_inventory": {
      const options = effectiveOptions({ ...block, type: "container_inventory" }), all = block.data as Container[];
      const items = sortInventory(all.filter(item => !options.hostKeys || options.hostKeys.includes(item.hostKey)), options, stale, now);
      return <Panel title="Containers descobertos" icon={<Box aria-hidden="true" />} note={items.length !== all.length ? `${items.length} exibidos de ${all.length} descobertos` : undefined}><ContainerInventory containers={items} stale={stale} availability={block.availability} compact visibleRows={options.visibleRows} emptyLabel={all.length && !items.length ? "Nenhum container corresponde ao filtro." : undefined} /></Panel>;
    }
    case "highlighted_resources": {
      const options = effectiveOptions({ ...block, type: "highlighted_resources" }), all = block.data as ConfiguredResource[], items = selectHighlights(all, options);
      const visible = items.length > 0 || probes.length > 0 || vps.length > 0 || signalCards.length > 0;
      return <section className="dashboard-panel availability-panel" style={{ "--service-rows": options.visibleRows } as CSSProperties} data-service-rows={options.visibleRows}><div className="panel-heading"><Box aria-hidden="true" /><h2>Disponibilidade de Serviços</h2><PlaceLink className="panel-link" href="/servicos">Todos os serviços <ArrowRight aria-hidden="true" /></PlaceLink></div>{visible ? <div className="availability-grid" tabIndex={0} role="region" aria-label="Recursos destacados">{items.map(item => <ServiceAvailabilityCard key={item.id} item={item} stale={stale} />)}{probes.map(item => <ProbeAvailabilityCard key={item.id} item={item} />)}{vps.map(item => <VpsAvailabilityCard key={item.id} item={item} />)}{signalCards.map(item => <SignalAvailabilityCard key={item.id} item={item} />)}</div> : <p className="panel-empty">{all.length ? "Nenhum destaque corresponde ao filtro." : "Nenhum serviço destacado. Configure os recursos que deseja acompanhar."}</p>}<p className="panel-foot">{items.length !== all.length ? `${items.length} exibidos de ${all.length} destacados · ` : ""}{items.length && probes.length ? "Estado do recurso · CPU / RAM na infraestrutura · latência nas aplicações" : items.length ? "Estado do recurso · CPU / RAM atuais · detalhes ao selecionar" : probes.length ? "Estado da consulta · latência atual · detalhes ao selecionar" : signalCards.length ? "Estado do Signal · workers · faixa de presença" : "Estado da VPS · faixa de presença · detalhes ao selecionar"}{(vps.length || signalCards.length) && (items.length || probes.length) ? " · faixa Signal/VPS" : ""}</p></section>;
    }
    case "resource_card": return <ResourceCard item={block.data as ConfiguredResource} stale={stale} />;
    case "uptime_list": return <UptimeList items={block.data as ProbeCard[]} options={effectiveOptions({ ...block, type: "uptime_list" })} />;
    case "problems": {
      const options = effectiveOptions({ ...block, type: "problems" }), all = block.data as Problem[], problems = selectProblems(all, options);
      return <Panel title="Problemas ativos" icon={<TriangleAlert aria-hidden="true" />} rows={options.visibleRows} note={`${problems.length !== all.length ? `${problems.length} exibidos de ${all.length} · ` : ""}Última atualização: ${timestamp(block.lastUpdated)}${stale ? " · Dados desatualizados" : ""}`}>
        {problems.length ? <ul className="problem-list" tabIndex={0} aria-label="Lista de problemas ativos">{problems.map(problem => <li key={problem.id}><SeverityPill severity={problem.severity} /><div><p title={problem.displayDescription ? problem.description : undefined}>{problem.displayDescription ?? problem.description}</p><small>{problem.resourceDisplayName ?? problem.resource.hostKey}</small></div><time dateTime={problem.startedAt}>{timestamp(problem.startedAt)}</time></li>)}</ul> : <p className="panel-empty">{stale || block.availability !== "ready" ? "Sem evidência atual de problemas." : all.length ? "Nenhum problema corresponde ao filtro." : "Nenhum problema ativo informado pela origem."}</p>}
      </Panel>;
    }
    default: return <Panel title="Bloco indisponível" icon={<TriangleAlert aria-hidden="true" />}><p className="panel-empty">Visualização ainda não disponível.</p></Panel>;
  }
}
