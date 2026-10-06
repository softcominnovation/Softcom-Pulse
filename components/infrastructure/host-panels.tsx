"use client";

import Link from "next/link";
import { useContext } from "react";
import { Activity, HardDrive, Layers, Server } from "lucide-react";
import type { Host, Metrics, VirtualMachine } from "@/lib/monitoring/contracts";
import { metricLabels } from "@/lib/infrastructure/history";
import { asgardUrl, evidenceExpired, hostUrl, type WindowRange } from "@/lib/infrastructure/navigation";
import { number, timestamp } from "@/lib/dashboard/format";
import { EvidenceTimeContext, MetricValue, Status } from "@/components/dashboard/metrics";
import { VmAgentSummary, VmCpuCount } from "./vm-summary";
import "./infrastructure.css";

export function MetricList({ metrics, stale }: { metrics: Metrics; stale: boolean }) {
  const entries = Object.entries(metrics) as [keyof Metrics, Metrics[keyof Metrics]][];
  return entries.length ? <dl className="detail-metrics">{entries.map(([key, metric]) => <div key={key}><dt>{metricLabels[key] ?? key}</dt><dd><MetricValue metric={metric} stale={stale} series={key.startsWith("memory") ? "memory" : key.startsWith("disk") ? "disk" : "cpu"} /></dd></div>)}</dl> : <p className="panel-empty">Métricas não informadas pela origem.</p>;
}
export function HostKpis({ host, stale }: { host: Host; stale: boolean }) {
  const now = useContext(EvidenceTimeContext);
  const running = host.vms.filter(vm => vm.state === "running" && !evidenceExpired(vm, stale, now)).length;
  return <section className="dashboard-kpis host-kpis" aria-label={`Indicadores de ${host.name}`}>
    <article className="dashboard-kpi"><div className="kpi-label"><h2>CPU do host</h2><Server aria-hidden="true" /></div><MetricValue metric={host.metrics.cpuUsagePercent} stale={stale} compact /><p>{host.role === "hypervisor" ? "Perspectiva do hipervisor" : "Perspectiva do Agent"}</p><Status value={host.availability} stale={evidenceExpired(host, stale, now)} /></article>
    <article className="dashboard-kpi"><div className="kpi-label"><h2>Memória do host</h2><Activity aria-hidden="true" /></div><MetricValue metric={host.metrics.memoryUsagePercent ?? host.metrics.memoryUsedBytes} stale={stale} series="memory" compact /><p>Capacidade informada</p><MetricValue metric={host.metrics.memoryTotalBytes} stale={stale} compact /></article>
    <article className="dashboard-kpi"><div className="kpi-label"><h2>{host.role === "hypervisor" ? "Armazenamento do host" : "Filesystem raiz"}</h2><HardDrive aria-hidden="true" /></div><MetricValue metric={host.metrics.diskUsagePercent ?? host.metrics.diskUsedBytes} stale={stale} series="disk" compact /><p>{host.storages.length ? `${number(host.storages.length)} storages · capacidades separadas abaixo` : "Uso informado pela origem"}</p></article>
    <article className="dashboard-kpi"><div className="kpi-label"><h2>{host.role === "hypervisor" ? "Máquinas virtuais" : "Tempo ativo"}</h2><Layers aria-hidden="true" /></div>{host.role === "hypervisor" ? <><p className="kpi-value">{number(host.vms.length)}</p><p>{number(running)} em execução com evidência atual</p></> : <MetricValue metric={host.metrics.uptimeSeconds} stale={stale} />}</article>
  </section>;
}
export function VmStateSummary({ vms, stale }: { vms: VirtualMachine[]; stale: boolean }) {
  const now = useContext(EvidenceTimeContext);
  const counts = { running: 0, stopped: 0, paused: 0, unknown: 0 };
  for (const vm of vms) counts[evidenceExpired(vm, stale, now) ? "unknown" : vm.state]++;
  return <section className="dashboard-panel vm-state-summary" aria-label="Resumo das VMs">
    <div className="panel-heading"><Layers aria-hidden="true" /><h2>Estado das VMs</h2><span className="vm-inventory-total">{number(vms.length)} VMs no inventário</span></div>
    <dl className="vm-state-counts">{([["running", "Em execução"], ["stopped", "Paradas"], ["paused", "Pausadas"], ["unknown", "Sem estado atual"]] as const).map(([state, label]) => <div key={state}><dt>{label}</dt><dd>{number(counts[state])}</dd></div>)}</dl>
  </section>;
}
export function DevicePanel({ title, devices, stale, network = false }: { title: string; devices: Host["storages"]; stale: boolean; network?: boolean }) {
  return <section className="dashboard-panel device-panel"><div className="panel-heading"><HardDrive aria-hidden="true" /><h2>{title}</h2></div>
    {devices.length ? <div className="device-list">{devices.map(device => <article key={device.key}><h3>{device.name}</h3>{network ? <MetricList metrics={device.metrics} stale={stale} /> : <><div className="device-amount"><span>Uso</span><MetricValue metric={device.metrics.diskUsagePercent ?? device.metrics.diskUsedBytes} stale={stale} series="disk" compact /></div><dl className="device-capacity"><div><dt>Usado</dt><dd><MetricValue metric={device.metrics.diskUsedBytes} stale={stale} compact /></dd></div><div><dt>Total</dt><dd><MetricValue metric={device.metrics.diskTotalBytes} stale={stale} compact /></dd></div></dl><p className="device-time">Evidência: {timestamp((device.metrics.diskUsagePercent ?? device.metrics.diskUsedBytes ?? device.metrics.diskTotalBytes)?.observedAt)}</p></>}</article>)}</div> : <p className="panel-empty">Nenhuma informação disponível na coleta atual.</p>}
    <p className="panel-foot">{network ? "Taxas por interface · não somadas entre interfaces." : "Capacidades apresentadas separadamente. Pools, discos virtuais e filesystems são medidas diferentes."}</p>
  </section>;
}
export function VmTable({ vms, stale, detailed = false, selected, range = "24h", hosts = [] }: { vms: VirtualMachine[]; stale: boolean; detailed?: boolean; selected?: string; range?: WindowRange; hosts?: Host[] }) {
  const now = useContext(EvidenceTimeContext);
  const compactDisk = !detailed && vms.some(vm => vm.metrics.diskUsagePercent || vm.metrics.diskUsedBytes || vm.metrics.diskTotalBytes);
  if (!vms.length) return <p className="panel-empty">Nenhuma VM informada na coleta atual.</p>;
  return <div className="vm-table-scroll" tabIndex={0} role="region" aria-label="Máquinas virtuais do hipervisor"><table className={`vm-summary ${detailed ? "vm-details-table" : ""}`}><thead><tr><th scope="col">VM no Asgard</th><th scope="col">Estado</th><th scope="col">CPU</th><th scope="col">RAM</th>{compactDisk && <th scope="col">Disco · hipervisor</th>}{detailed && <><th scope="col">Disco virtual</th><th scope="col">Filesystem · Agent</th><th scope="col">Tempo ativo</th><th scope="col">Evidência</th></>}</tr></thead><tbody>{vms.map(vm => {
    const agent = vm.linuxHostKey ? hosts.find(host => host.hostKey === vm.linuxHostKey && host.role === "linux") : undefined;
    return <tr key={vm.vmKey} className={selected === vm.vmKey ? "vm-selected" : undefined}>
      <th scope="row"><Link className="vm-name-link" prefetch={false} onNavigate={() => window.scrollTo(0, 0)} href={asgardUrl(vm.parentHostKey, vm.vmKey, range)} aria-current={selected === vm.vmKey ? "true" : undefined}>{vm.name}{selected === vm.vmKey && <span className="sr-only"> · VM selecionada</span>}</Link>{detailed && <small>ID {vm.vmId ?? "não informado"} · {vm.linuxHostKey ? <Link href={hostUrl(vm.linuxHostKey, range)}>Detalhes do Agent</Link> : "Sem Agent associado"}</small>}</th>
      <td><Status value={vm.state} stale={evidenceExpired(vm, stale, now)} /></td>
      <td><MetricValue metric={vm.metrics.cpuUsagePercent} stale={stale} compact meter={detailed} />{detailed && <VmCpuCount vm={vm} stale={stale} />}</td>
      <td>{detailed ? <>{vm.metrics.memoryUsagePercent && <MetricValue metric={vm.metrics.memoryUsagePercent} stale={stale} series="memory" compact />}<small>Usada / total</small><div className="vm-memory-capacity"><MetricValue metric={vm.metrics.memoryUsedBytes} stale={stale} compact /><span aria-hidden="true">/</span><MetricValue metric={vm.metrics.memoryTotalBytes} stale={stale} compact /></div></> : <MetricValue metric={vm.metrics.memoryUsagePercent ?? vm.metrics.memoryUsedBytes} stale={stale} series="memory" compact meter={false} />}</td>
      {compactDisk && <td><MetricValue metric={vm.metrics.diskUsagePercent ?? vm.metrics.diskUsedBytes ?? vm.metrics.diskTotalBytes} stale={stale} series="disk" compact /><small>{vm.metrics.diskUsagePercent || vm.metrics.diskUsedBytes ? "Uso reportado" : "Capacidade virtual"}</small></td>}
      {detailed && <><td><MetricValue metric={vm.metrics.diskTotalBytes} stale={stale} series="disk" compact /><small>Capacidade no hipervisor</small></td><td><VmAgentSummary vm={vm} agent={agent} stale={stale} /></td><td><MetricValue metric={vm.metrics.uptimeSeconds} stale={stale} compact /></td><td><time dateTime={vm.evidence.observedAt ?? undefined}>{timestamp(vm.evidence.observedAt)}</time></td></>}
    </tr>;
  })}</tbody></table></div>;
}
export function HostInventory({ hosts, stale, compact = false }: { hosts: Host[]; stale: boolean; compact?: boolean }) {
  const now = useContext(EvidenceTimeContext);
  return <section className={`dashboard-panel host-inventory ${compact ? "host-inventory-compact" : ""}`}><div className="panel-heading"><Server aria-hidden="true" /><h2>Hosts monitorados</h2></div>
    {hosts.length ? <div className="host-card-grid" tabIndex={compact ? 0 : undefined} role="region" aria-label="Inventário de hosts">{hosts.map(host => <article className="host-card" key={host.hostKey}><h3><Link href={host.role === "hypervisor" ? asgardUrl(host.hostKey) : hostUrl(host.hostKey)}>{host.name}</Link></h3><p>{host.role === "hypervisor" ? "Hipervisor · Zabbix" : host.role === "linux" ? "Linux · Agent" : "Origem não identificada"}</p><Status value={host.availability} stale={evidenceExpired(host, stale, now)} /><dl className="detail-metrics"><div><dt>CPU</dt><dd><MetricValue metric={host.metrics.cpuUsagePercent} stale={stale} compact /></dd></div><div><dt>RAM</dt><dd><MetricValue metric={host.metrics.memoryUsagePercent ?? host.metrics.memoryUsedBytes} stale={stale} series="memory" compact /></dd></div><div><dt>Tempo ativo</dt><dd><MetricValue metric={host.metrics.uptimeSeconds} stale={stale} compact /></dd></div><div><dt>{host.role === "hypervisor" ? "VMs operacionais" : "Filesystems"}</dt><dd>{number(host.role === "hypervisor" ? host.vms.length : host.filesystems.length)}</dd></div></dl></article>)}</div> : <p className="panel-empty">Nenhum host disponível no escopo atual.</p>}
    <p className="panel-foot">Somente recursos do escopo monitorado · métricas atuais · selecione um host para abrir seu histórico.</p>
  </section>;
}
