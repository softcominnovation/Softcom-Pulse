import Link from "next/link";
import { ArrowRight, Box, Layers, Server, TriangleAlert } from "lucide-react";
import { useContext, type CSSProperties, type ReactNode } from "react";
import { effectiveOptions, indicatorKeys, type OptionsByType } from "@/lib/config/presentation";
import { selectHighlights, selectProblems, sortInventory } from "@/lib/dashboard/block-options";
import { EvidenceTimeContext } from "./metrics";
import type { AsgardSummary, ConfiguredResource, Container, Host, OverviewBlock, ProbeCard, Problem, Summary } from "@/lib/monitoring/contracts";
import { HostInventory } from "@/components/infrastructure/host-panels";
import { number, timestamp } from "@/lib/dashboard/format";
import { SeverityPill } from "@/components/services/states";
import { ContainerInventory } from "@/components/services/container-inventory";
import { AsgardPanel } from "./asgard-panel";
import { ResourceCard } from "./resource-card";
import { ServiceAvailabilityCard } from "./service-availability-card";
import { ProbeAvailabilityCard } from "./probe-card";
import { UptimeList } from "./uptime-list";
import "./availability.css";

function Panel({ title, icon, children, note, rows }: { title: string; icon: ReactNode; children: ReactNode; note?: string; rows?: number }) {
  return <section className="dashboard-panel configured-panel" style={rows ? { "--visible-rows": rows } as CSSProperties : undefined}><div className="panel-heading">{icon}<h2>{title}</h2></div>{children}{note && <p className="panel-foot">{note}</p>}</section>;
}
function SummaryBlock({ data, stale, options }: { data: Summary; stale: boolean; options: OptionsByType["summary"] }) {
  const items = [
    { label: "Hosts monitorados", value: data.hostsKnown, icon: <Server />, note: `${number(data.hostsReachable)} alcançáveis · ${number(data.vms)} VMs no hipervisor` },
    { label: "Containers em execução", value: data.containersRunning, icon: <Box />, note: `${number(data.containersTotal)} containers no total` },
    { label: "Containers parados", value: data.containersStopped, icon: <Layers />, note: "Total informado pela origem" },
    { label: "Problemas ativos", value: data.problems, icon: <TriangleAlert />, note: `${number(data.criticalAffected)} recursos críticos afetados` },
  ];
  return <section className={`dashboard-kpis ${stale ? "is-stale" : ""}`} aria-label="Indicadores da operação">{options.indicators.map(key => items[indicatorKeys.indexOf(key)]).map(item => <article className="dashboard-kpi" key={item.label}><div className="kpi-label"><h2>{item.label}</h2><span aria-hidden="true">{item.icon}</span></div><p className="kpi-value">{number(item.value)}</p><p>{item.value === null ? "Sem dados da origem" : stale ? "Dados desatualizados" : item.note}</p>{stale && <p>{item.note}</p>}</article>)}</section>;
}
export function DashboardBlock({ block, failed, probes = [] }: { block: OverviewBlock; failed: boolean; probes?: ProbeCard[] }) {
  const stale = failed || block.stale, now = useContext(EvidenceTimeContext);
  if (block.availability === "unavailable" || block.data === null) return <Panel title="Bloco indisponível" icon={<TriangleAlert aria-hidden="true" />}><p className="panel-empty">Este bloco não está disponível na configuração atual.</p></Panel>;
  switch (block.type) {
    case "summary": return <SummaryBlock data={block.data as Summary} stale={stale} options={effectiveOptions({ ...block, type: "summary" })} />;
    case "asgard_summary": return <AsgardPanel data={block.data as AsgardSummary} stale={stale} options={effectiveOptions({ ...block, type: "asgard_summary" })} />;
    case "host_inventory": {
      const options = effectiveOptions({ ...block, type: "host_inventory" });
      return <HostInventory hosts={sortInventory(block.data as Host[], options, stale, now)} stale={stale} compact visibleRows={options.visibleRows} />;
    }
    case "container_inventory": {
      const options = effectiveOptions({ ...block, type: "container_inventory" }), all = block.data as Container[];
      const items = sortInventory(all.filter(item => !options.hostKeys || options.hostKeys.includes(item.hostKey)), options, stale, now);
      return <Panel title="Containers descobertos" icon={<Box aria-hidden="true" />} note={items.length !== all.length ? `${items.length} exibidos de ${all.length} descobertos` : undefined}><ContainerInventory containers={items} stale={stale} availability={block.availability} compact visibleRows={options.visibleRows} emptyLabel={all.length && !items.length ? "Nenhum container corresponde ao filtro." : undefined} /></Panel>;
    }
    case "highlighted_resources": {
      const options = effectiveOptions({ ...block, type: "highlighted_resources" }), all = block.data as ConfiguredResource[], items = selectHighlights(all, options);
      const visible = items.length > 0 || probes.length > 0;
      return <section className="dashboard-panel availability-panel" style={{ "--service-rows": Math.min(2, options.visibleRows) } as CSSProperties}><div className="panel-heading"><Box aria-hidden="true" /><h2>Disponibilidade de Serviços</h2><Link className="panel-link" href="/servicos">Todos os serviços <ArrowRight aria-hidden="true" /></Link></div>{visible ? <div className="availability-grid" tabIndex={0} role="region" aria-label="Recursos destacados">{items.map(item => <ServiceAvailabilityCard key={item.id} item={item} stale={stale} />)}{probes.map(item => <ProbeAvailabilityCard key={item.id} item={item} />)}</div> : <p className="panel-empty">{all.length ? "Nenhum destaque corresponde ao filtro." : "Nenhum serviço destacado. Configure os recursos que deseja acompanhar."}</p>}<p className="panel-foot">{items.length !== all.length ? `${items.length} exibidos de ${all.length} destacados · ` : ""}{items.length && probes.length ? "Estado do recurso · CPU / RAM na infraestrutura · latência nas aplicações" : items.length ? "Estado do recurso · CPU / RAM atuais · detalhes ao selecionar" : "Estado da consulta · latência atual · detalhes ao selecionar"}</p></section>;
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
