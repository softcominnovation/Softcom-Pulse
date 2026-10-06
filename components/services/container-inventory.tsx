"use client";

import { Box } from "lucide-react";
import type { Availability, ConfiguredResource, Container } from "@/lib/monitoring/contracts";
import { number, timestamp } from "@/lib/dashboard/format";
import { resolutionLabel } from "@/lib/services/presentation";
import { MetricValue } from "@/components/dashboard/metrics";
import { ReadNotice } from "@/components/infrastructure/data";
import { ContainerHealth, ContainerStatus } from "./states";
import { ServiceDetailsTrigger, ServiceMetrics } from "./service-details";
import { useContainers } from "./data";
import "./services.css";

export function ContainerInventory({ containers, configuredServices = [], stale, availability = "ready", compact = false }: { containers: Container[]; configuredServices?: ConfiguredResource[]; stale: boolean; availability?: Availability; compact?: boolean }) {
  const hostKeys = [...new Set(containers.map(item => item.hostKey))];
  const unresolved = configuredServices.filter(item => !item.resolved || !item.resource || !("reference" in item.resource) || !containers.some(container => container.hostKey === item.resource!.hostKey && container.reference === (item.resource as Container).reference));
  return <div className={`container-inventory ${compact ? "container-inventory-compact" : ""}`}>
    {!containers.length && <p className="panel-empty">{availability !== "ready" ? "Sem inventário de containers disponível nesta coleta." : "Nenhum container individualizado nesta coleta."}</p>}
    {hostKeys.map(hostKey => <section key={hostKey} className="container-host-group" aria-label={`Containers de ${hostKey}`}><div className="panel-heading"><Box aria-hidden="true" /><h3>{hostKey}</h3><span className="inventory-count">{number(containers.filter(item => item.hostKey === hostKey).length)} itens descobertos</span></div>
      <p className="container-scroll-hint">Role a tabela para consultar todas as colunas e detalhes.</p><div className="container-table-scroll" role="region" tabIndex={0} aria-label={`Lista de containers de ${hostKey}`}><table className="container-table"><thead><tr>{["Container / imagem", "Estado", "Healthcheck", "CPU", "Memória", "Reinícios", "Evidência / detalhes"].map(title => <th key={title} scope="col">{title}</th>)}</tr></thead><tbody>{containers.filter(item => item.hostKey === hostKey).map(container => {
        const configs = configuredServices.filter(item => item.resolved && item.resource && "reference" in item.resource && item.resource.reference === container.reference && item.resource.hostKey === container.hostKey);
        return <tr key={container.reference}><th scope="row"><strong>{container.name}</strong><small className="container-image">{container.image ?? "Imagem não informada"}</small>{configs.map(item => <div className="container-config" key={item.id}><span>{item.config.displayName ?? item.config.selectorValue}{!item.config.enabled ? " · Desabilitado" : ""}</span><ServiceDetailsTrigger item={item} /></div>)}</th><td><ContainerStatus container={container} stale={stale} /></td><td><ContainerHealth container={container} stale={stale} /></td><td><MetricValue metric={container.metrics.cpuUsagePercent} stale={stale} compact /></td><td><MetricValue metric={container.metrics.memoryUsagePercent ?? container.metrics.memoryUsedBytes} stale={stale} series="memory" compact /></td><td><MetricValue metric={container.metrics.restartCount} stale={stale} compact meter={false} /></td><td><time dateTime={container.evidence.observedAt ?? undefined}>{timestamp(container.evidence.observedAt)}</time><details className="container-extra"><summary>Mais dados de {container.name}</summary><p>Fonte: Zabbix · {container.hostKey}</p><ServiceMetrics metrics={{ memoryUsedBytes: container.metrics.memoryUsedBytes, memoryTotalBytes: container.metrics.memoryTotalBytes, networkReceiveBitsPerSecond: container.metrics.networkReceiveBitsPerSecond, networkTransmitBitsPerSecond: container.metrics.networkTransmitBitsPerSecond, uptimeSeconds: container.metrics.uptimeSeconds }} stale={stale} /></details></td></tr>;
      })}</tbody></table></div></section>)}
    {unresolved.length > 0 && <section className="unresolved-services"><h3>Configurações sem container individualizado</h3>{unresolved.map(item => <article key={item.id}><strong>{item.config.displayName ?? item.config.selectorValue ?? item.config.zabbixHostKey}</strong><p>{item.resolved ? "Container não incluído nesta leitura do inventário" : resolutionLabel(item)}{!item.config.enabled ? " · Configuração desabilitada" : ""}</p><ServiceDetailsTrigger item={item} /></article>)}</section>}
    <p className="panel-foot">Itens descobertos pelo Zabbix, não o total instalado. A descoberta pode ser parcial e tem seu próprio intervalo de atualização. Estado em execução não confirma health saudável.</p>
  </div>;
}
export function HostContainers({ hostKey }: { hostKey: string }) {
  const poll = useContainers(hostKey);
  return <section className="dashboard-panel"><div className="panel-heading"><Box aria-hidden="true" /><h2>Containers do Agent</h2></div><ReadNotice result={poll.data} failed={poll.failed} refresh={poll.refresh} label="containers do Agent" />{poll.data && <ContainerInventory containers={poll.data.data} stale={poll.failed || poll.data.stale} availability={poll.data.availability} />}</section>;
}
