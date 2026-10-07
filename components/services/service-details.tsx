"use client";

import { useState, type ReactElement } from "react";
import type { ConfiguredResource, Metrics } from "@/lib/monitoring/contracts";
import type { ResourcePresentation } from "@/lib/config/resources";
import { resolutionLabel, visibleMetric } from "@/lib/services/presentation";
import { metricLabels } from "@/lib/infrastructure/history";
import { timestamp } from "@/lib/dashboard/format";
import { MetricValue, Status } from "@/components/dashboard/metrics";
import { ReadNotice } from "@/components/infrastructure/data";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useServices } from "./data";
import { ContainerHealth, ContainerStatus } from "./states";
import { ServiceHistory } from "./service-history";
import "./services.css";

function configuredMetrics(metrics: Metrics, p: ResourcePresentation, container: boolean): Metrics {
  const expected = [...(p.showCpu ? ["cpuUsagePercent"] : []), ...(p.showMemory ? ["memoryUsedBytes", "memoryTotalBytes"] : []), ...(p.showDisk ? ["diskUsagePercent"] : []), ...(p.showNetwork ? ["networkReceiveBitsPerSecond", "networkTransmitBitsPerSecond"] : []), ...(p.showUptime ? ["uptimeSeconds"] : []), ...(container ? ["restartCount"] : [])];
  return Object.fromEntries([...new Set([...expected, ...Object.keys(metrics).filter(key => visibleMetric(key, p))])].map(key => [key, metrics[key as keyof Metrics]]));
}

export function ServiceDetailsTrigger({ item, trigger }: { item: ConfiguredResource; trigger?: ReactElement }) {
  const [open, setOpen] = useState(false);
  const name = item.config.displayName ?? item.resource?.displayName ?? item.resource?.name ?? item.config.zabbixHostKey;
  return <Dialog open={open} onOpenChange={setOpen}><DialogTrigger asChild>{trigger ?? <Button variant="ghost" aria-label={`Detalhes de ${name}`}>Detalhes</Button>}</DialogTrigger>{open && <DialogContent className="service-dialog"><DialogHeader><DialogTitle>{name}</DialogTitle><DialogDescription>Recurso configurado · {item.config.zabbixHostKey}</DialogDescription></DialogHeader><DialogBody><ServiceContent id={item.id} /></DialogBody></DialogContent>}</Dialog>;
}
function ServiceContent({ id }: { id: string }) {
  const poll = useServices(id), item = poll.data?.data[0], stale = poll.failed || !!poll.data?.stale;
  const p = item?.config.presentation, target = item?.resource;
  return <div className="service-content"><ReadNotice result={poll.data} failed={poll.failed} refresh={poll.refresh} label="recurso" />{item && p && <>
    {!item.config.enabled && <p className="service-note">Configuração desabilitada. Não é exibida no dashboard.</p>}
    {!item.resolved ? <p className="resource-missing">{resolutionLabel(item)}. A configuração foi preservada.</p> : target && <>
      <div className="service-state-pair">{p.showStatus && <div><h3>Estado</h3>{"reference" in target ? <ContainerStatus container={target} stale={stale} /> : <Status value={target.availability} stale={stale} />}</div>}{"showHealth" in p && p.showHealth && "reference" in target && <div><h3>Healthcheck</h3><ContainerHealth container={target} stale={stale} /></div>}</div>
      <dl className="service-identity">{item.config.description && <div><dt>Descrição</dt><dd>{item.config.description}</dd></div>}{item.config.serviceType && <div><dt>Tipo do serviço</dt><dd>{item.config.serviceType}</dd></div>}<div><dt>Nome técnico</dt><dd>{target.name}</dd></div>{"image" in target && <div><dt>Imagem</dt><dd>{target.image ?? "Não informada"}</dd></div>}<div><dt>Última evidência · Zabbix</dt><dd>{timestamp(target.evidence.observedAt)}</dd></div></dl>
      <ServiceMetrics metrics={configuredMetrics(item.metrics, p, "reference" in target)} stale={stale} />
      {"availability" in target && [...(p.showDisk ? [...target.storages, ...target.filesystems] : []), ...(p.showNetwork ? target.interfaces : [])].map(device => <section key={device.key}><h3>{device.name}</h3><ServiceMetrics metrics={Object.fromEntries(Object.entries(device.metrics).filter(([key]) => visibleMetric(key, p)))} stale={stale} /></section>)}
      {(p.showCpu || p.showMemory || p.showDisk || p.showNetwork || p.showUptime || "showHealthTimeline" in p && p.showHealthTimeline) && <ServiceHistory key={`${item.id}:${target.hostKey}:${"reference" in target ? target.reference : "host"}`} item={item} />}
    </>}
  </>}</div>;
}
export function ServiceMetrics({ metrics, stale }: { metrics: Metrics; stale: boolean }) {
  return <dl className="service-metrics">{Object.entries(metrics).map(([key, metric]) => <div key={key}><dt>{key === "restartCount" ? "Reinícios" : metricLabels[key] ?? key}</dt><dd><MetricValue metric={metric} stale={stale} series={key.startsWith("memory") ? "memory" : key.startsWith("disk") ? "disk" : "cpu"} /></dd></div>)}</dl>;
}
