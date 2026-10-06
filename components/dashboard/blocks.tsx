import { Activity, Box, Layers, Server, TriangleAlert } from "lucide-react";
import type { ReactNode } from "react";
import type { AsgardSummary, ConfiguredResource, Container, Host, OverviewBlock, Problem, Summary } from "@/lib/monitoring/contracts";
import { HostInventory } from "@/components/infrastructure/host-panels";
import { number, timestamp } from "@/lib/dashboard/format";
import { SeverityPill } from "@/components/services/states";
import { ContainerInventory } from "@/components/services/container-inventory";
import { AsgardPanel } from "./asgard-panel";
import { ResourceCard } from "./resource-card";

function Panel({ title, icon, children, note }: { title: string; icon: ReactNode; children: ReactNode; note?: string }) {
  return <section className="dashboard-panel"><div className="panel-heading">{icon}<h2>{title}</h2></div>{children}{note && <p className="panel-foot">{note}</p>}</section>;
}
function SummaryBlock({ data, stale }: { data: Summary; stale: boolean }) {
  const items = [
    { label: "Hosts monitorados", value: data.hostsKnown, icon: <Server />, note: `${number(data.hostsReachable)} alcançáveis · ${number(data.vms)} VMs no hipervisor` },
    { label: "Containers em execução", value: data.containersRunning, icon: <Box />, note: `${number(data.containersTotal)} containers no total` },
    { label: "Containers parados", value: data.containersStopped, icon: <Layers />, note: "Total informado pela origem" },
    { label: "Problemas ativos", value: data.problems, icon: <TriangleAlert />, note: `${number(data.criticalAffected)} recursos críticos afetados` },
  ];
  return <section className={`dashboard-kpis ${stale ? "is-stale" : ""}`} aria-label="Indicadores da operação">{items.map(item => <article className="dashboard-kpi" key={item.label}><div className="kpi-label"><h2>{item.label}</h2><span aria-hidden="true">{item.icon}</span></div><p className="kpi-value">{number(item.value)}</p><p>{item.value === null ? "Sem dados da origem" : stale ? "Dados desatualizados" : item.note}</p>{stale && <p>{item.note}</p>}</article>)}</section>;
}
export function DashboardBlock({ block, failed }: { block: OverviewBlock; failed: boolean }) {
  const stale = failed || block.stale;
  if (block.availability === "unavailable" || block.data === null) return <Panel title="Bloco indisponível" icon={<TriangleAlert aria-hidden="true" />}><p className="panel-empty">Este bloco não está disponível na configuração atual.</p></Panel>;
  switch (block.type) {
    case "summary": return <SummaryBlock data={block.data as Summary} stale={stale} />;
    case "asgard_summary": return <AsgardPanel data={block.data as AsgardSummary} stale={stale} />;
    case "host_inventory": return <HostInventory hosts={block.data as Host[]} stale={stale} compact />;
    case "container_inventory": return <Panel title="Containers descobertos" icon={<Box aria-hidden="true" />}><ContainerInventory containers={block.data as Container[]} stale={stale} availability={block.availability} compact /></Panel>;
    case "highlighted_resources": {
      const items = block.data as ConfiguredResource[];
      return <Panel title="Serviços destacados" icon={<Activity aria-hidden="true" />} note="Exibição conforme as preferências de cada recurso.">{items.length ? <div className="resource-grid" tabIndex={0} role="region" aria-label="Recursos destacados">{items.map(item => <ResourceCard key={item.id} item={item} stale={stale} compact />)}</div> : <p className="panel-empty">Nenhum serviço destacado. Os recursos configurados para destaque aparecerão aqui.</p>}</Panel>;
    }
    case "resource_card": return <ResourceCard item={block.data as ConfiguredResource} stale={stale} />;
    case "problems": {
      const problems = [...block.data as Problem[]].sort((a, b) => b.severity - a.severity || b.startedAt.localeCompare(a.startedAt));
      return <Panel title="Problemas ativos" icon={<TriangleAlert aria-hidden="true" />} note={`Última atualização: ${timestamp(block.lastUpdated)}${stale ? " · Dados desatualizados" : ""}`}>
        {problems.length ? <ul className="problem-list" tabIndex={0} aria-label="Lista de problemas ativos">{problems.map(problem => <li key={problem.id}><SeverityPill severity={problem.severity} /><div><p title={problem.displayDescription ? problem.description : undefined}>{problem.displayDescription ?? problem.description}</p><small>{problem.resource.hostKey}</small></div><time dateTime={problem.startedAt}>{timestamp(problem.startedAt)}</time></li>)}</ul> : <p className="panel-empty">{stale || block.availability !== "ready" ? "Sem evidência atual de problemas." : "Nenhum problema ativo informado pela origem."}</p>}
      </Panel>;
    }
    default: return <Panel title="Bloco indisponível" icon={<TriangleAlert aria-hidden="true" />}><p className="panel-empty">Visualização ainda não disponível.</p></Panel>;
  }
}
