"use client";
import { useContext, useEffect, useRef, type CSSProperties, type ReactNode } from "react";
import { IconDatabase } from "@tabler/icons-react";
import type { StorageView } from "@/lib/storage/contracts";
import { storageStatus, visibleStorageVolumes } from "@/lib/storage/presentation";
import { timestamp } from "@/lib/dashboard/format";
import { EvidenceTimeContext, MetricValue } from "@/components/dashboard/metrics";
import { ServiceTitle } from "@/components/dashboard/service-title";
import { storagePanelMinimum } from "@/lib/dashboard/storage-panel-size";
import "./storage.css";

export function StoragePanel({ item, stale = false, visibleRows = 3, actions }: { item: StorageView | null; stale?: boolean; visibleRows?: number; actions?: ReactNode }) {
  const root = useRef<HTMLElement>(null);
  useEffect(() => {
    const panel = root.current;
    if (!panel) return;
    const check = () => {
      const body = panel.querySelector<HTMLElement>(".storage-body");
      if (!body) return;
      // Keep the dashboard's row budget. Small slots scroll their content in one
      // place instead of enlarging the entire composition or clipping readings.
      const constrained = panel.offsetHeight + 1 < storagePanelMinimum(panel);
      const mode = constrained ? "body" : "volumes";
      if (panel.dataset.storageScroll !== mode) panel.dataset.storageScroll = mode;
      body.tabIndex = constrained ? 0 : -1;
    };
    const observer = new ResizeObserver(check), observed = new Set<Element>();
    const watch = () => {
      const targets = new Set<Element>([panel, ...panel.querySelectorAll(".panel-heading,.panel-foot,.storage-body > *,.storage-volumes thead,.storage-volumes tbody tr:first-child")]);
      observed.forEach(node => { if (!targets.has(node)) { observer.unobserve(node); observed.delete(node); } });
      targets.forEach(node => { if (!observed.has(node)) { observer.observe(node); observed.add(node); } });
      check();
    };
    const changes = new MutationObserver(watch);
    changes.observe(panel, { childList: true, subtree: true }); watch();
    return () => { observer.disconnect(); changes.disconnect(); };
  }, []);
  const now = useContext(EvidenceTimeContext);
  const old = stale || !!item?.stale;
  const volumes = item ? visibleStorageVolumes(item) : [];
  const status = item ? storageStatus({ ...item, stale: old }, now) : { label: "Sem dados", tone: "unknown" };
  return <section ref={root} className="dashboard-panel storage-panel" style={{ "--storage-rows": visibleRows } as CSSProperties} aria-label={`Storage ${item?.displayName ?? "indisponível"}`}>
    <div className="panel-heading"><IconDatabase aria-hidden="true" /><ServiceTitle status={<span className={`status-pill tone-${status.tone}`}><i className="status-dot" />{status.label}</span>}><h2 title={item?.displayName}>{item?.displayName ?? "Storage indisponível"}</h2></ServiceTitle>{actions && <div className="storage-actions">{actions}</div>}</div>
    {item ? <div className="storage-body" role="region" aria-label="Dados do Storage">
      {item.presentationStatus === "unavailable" && <p role="status" className="storage-note">Personalização indisponível; identificação técnica preservada.</p>}
      {item.description && <p className="storage-note">{item.description}</p>}
      <div className="storage-primary">{([
        ["CPU", item.metrics.cpuUsagePercent, "cpu"], ["RAM", item.metrics.memoryUsagePercent, "memory"], ["Disco ocupado", item.capacity.usagePercent, "disk"],
      ] as const).map(([label, metric, series]) => <div key={label}><span>{label}</span><MetricValue metric={metric} stale={old} series={series} compact /></div>)}</div>
      <div className="storage-secondary"><div><span>Usado / total</span><div className="storage-capacity"><MetricValue metric={item.capacity.usedBytes} stale={old} compact meter={false} /><span>/</span><MetricValue metric={item.capacity.totalBytes} stale={old} compact meter={false} /></div></div><div><span>Disponível</span><MetricValue metric={item.capacity.availableBytes} stale={old} compact meter={false} /></div><div><span>Tempo ativo</span><MetricValue metric={item.metrics.uptimeSeconds} stale={old} compact meter={false} /></div>{item.metrics.ioWaitPercent && <div><span>Espera por I/O</span><MetricValue metric={item.metrics.ioWaitPercent} stale={old} compact meter={false} /></div>}</div>
      {item.capacity.coverage !== "complete" && <p className="storage-note">{item.capacity.coverage === "unconfigured" ? "Selecione os volumes para definir a capacidade monitorada." : "Capacidade incompleta: um ou mais volumes não têm todos os dados necessários."}</p>}
      {volumes.length ? <div className="storage-volumes" tabIndex={0} role="region" aria-label="Volumes visíveis"><table><thead><tr><th>Volume</th><th>Ocupado</th><th>Usado / total</th><th>Disponível</th><th>Inodes livres</th><th>Acesso</th></tr></thead><tbody>{volumes.map(volume => {
        const readOnly = volume.readOnly;
        const valid = !old && readOnly?.quality === "fresh" && readOnly.validUntil && Date.parse(readOnly.validUntil) > now;
        return <tr key={volume.key}><td title={volume.name}>{volume.name}</td><td><MetricValue metric={volume.metrics.diskUsagePercent} series="disk" stale={old} compact /></td><td><div className="storage-capacity"><MetricValue metric={volume.metrics.diskUsedBytes} stale={old} compact meter={false} /><span>/</span><MetricValue metric={volume.metrics.diskTotalBytes} stale={old} compact meter={false} /></div></td><td><MetricValue metric={volume.availableBytes} stale={old} compact meter={false} /></td><td><MetricValue metric={volume.inodesFreePercent} stale={old} compact meter={false} /></td><td>{valid && readOnly.value === 1 ? "Somente leitura" : valid && readOnly.value === 0 ? "Leitura e escrita" : "Desconhecido"}</td></tr>;
      })}</tbody></table></div> : <p className="storage-note">{item.visibleFilesystemKeys?.length ? "Os volumes escolhidos para exibição não estão disponíveis nesta leitura." : "Nenhum volume com métricas identificado nesta leitura."}</p>}
      {item.selectedInterface && <div className="storage-network"><span title={item.selectedInterface.name}>{item.selectedInterface.name}</span><span>RX <MetricValue metric={item.selectedInterface.metrics.networkReceiveBitsPerSecond} stale={old} compact meter={false} /></span><span>TX <MetricValue metric={item.selectedInterface.metrics.networkTransmitBitsPerSecond} stale={old} compact meter={false} /></span></div>}
    </div> : <p className="panel-empty">A referência de Storage não está disponível. Revise a configuração em Serviços.</p>}
    <p className="panel-foot storage-foot"><span>Zabbix · Agent{item ? ` · ${volumes.length} de ${item.volumes.length} volumes visíveis · ${item.capacity.label}` : ""}</span><span>Leitura {timestamp(item?.evidence.observedAt)}{old ? " · Desatualizado" : ""}</span></p>
  </section>;
}
