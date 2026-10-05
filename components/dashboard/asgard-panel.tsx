import Link from "next/link";
import { ArrowRight, HardDrive, Server } from "lucide-react";
import { useContext } from "react";
import type { AsgardSummary, VirtualMachine } from "@/lib/monitoring/contracts";
import { number, timestamp } from "@/lib/dashboard/format";
import { EvidenceTimeContext, MetricValue, Status } from "./metrics";

function evidenceOld(vm: { evidence: VirtualMachine["evidence"] }, stale: boolean, now: number) {
  return stale || !vm.evidence.observedAt || !!vm.evidence.validUntil && Date.parse(vm.evidence.validUntil) < now;
}

export function AsgardPanel({ data, stale, detailed = false }: { data: AsgardSummary; stale: boolean; detailed?: boolean }) {
  const { host, vms } = data, now = useContext(EvidenceTimeContext);
  const running = vms.filter(vm => vm.state === "running" && !evidenceOld(vm, stale, now)).length;
  const unknown = vms.filter(vm => vm.state === "unknown" || evidenceOld(vm, stale, now)).length;
  const hasDisk = vms.some(vm => vm.metrics.diskUsagePercent !== undefined || vm.metrics.diskUsedBytes !== undefined);
  return <section className={`dashboard-panel asgard-panel ${detailed ? "asgard-detailed" : "asgard-compact"}`}>
    <div className="panel-heading"><Server aria-hidden="true" /><h2>{host?.name ?? "Asgard"} · armazenamento & VMs</h2>{!detailed && host && <Link className="panel-link" href={`/asgard?hostKey=${encodeURIComponent(host.hostKey)}`}>Ver ASGARD<ArrowRight aria-hidden="true" /></Link>}</div>
    {!host ? <p className="panel-empty">Sem dados do hipervisor na coleta atual.</p> : <>
      <div className="asgard-content">
        <div className="asgard-context">
          <div className="asgard-overview">
            <div className="asgard-identity">{detailed && host.hostKey !== host.name && <strong>{host.hostKey}</strong>}<Status value={host.availability} stale={evidenceOld(host, stale, now)} />{detailed && <p>Evidência: {timestamp(host.evidence.observedAt)}</p>}</div>
            <dl className="asgard-metrics"><div><dt>CPU</dt><dd><MetricValue metric={host.metrics.cpuUsagePercent} stale={stale} compact={!detailed} /></dd></div><div><dt>RAM</dt><dd><MetricValue metric={host.metrics.memoryUsagePercent ?? host.metrics.memoryUsedBytes} stale={stale} series="memory" compact={!detailed} /></dd></div></dl>
          </div>
          <div className="storage-summary">
            {detailed && <h3><HardDrive aria-hidden="true" />Armazenamento</h3>}
            {host.storages.length ? <div className="storage-grid" tabIndex={!detailed ? 0 : undefined} role="region" aria-label="Armazenamento do hipervisor">{host.storages.map(storage => <article key={storage.key}><h4>{storage.name}</h4><MetricValue metric={storage.metrics.diskUsagePercent ?? storage.metrics.diskUsedBytes} stale={stale} series="disk" compact={!detailed} />{detailed && <><p className="storage-capacity">Total</p><MetricValue metric={storage.metrics.diskTotalBytes} stale={stale} compact /></>}</article>)}</div> : <p className="storage-empty">Armazenamento não informado pela origem.</p>}
          </div>
        </div>
        <div className="asgard-machines">
          {detailed && <div className="vm-caption"><h3>Máquinas virtuais <span>{number(vms.length)}</span></h3><p>Role a tabela para ver todas as colunas e VMs.</p></div>}
          {vms.length ? <div className="vm-table-scroll" tabIndex={0} role="region" aria-label="Máquinas virtuais do hipervisor"><table className="vm-summary"><thead><tr><th scope="col">VM no Asgard</th><th scope="col">Estado</th><th scope="col">CPU</th><th scope="col">RAM</th>{hasDisk && <th scope="col">Disco do hipervisor</th>}{detailed && <><th scope="col">Tempo ativo</th><th scope="col">Evidência</th></>}</tr></thead><tbody>{vms.map(vm => <tr key={vm.vmKey}>
            <th scope="row">{vm.name}{detailed && <small>ID {vm.vmId ?? "não informado"} · {vm.linuxHostKey ? `Agent: ${vm.linuxHostKey}` : "Sem Agent associado"}</small>}</th>
            <td><Status value={vm.state} stale={evidenceOld(vm, stale, now)} /></td>
            <td><MetricValue metric={vm.metrics.cpuUsagePercent} stale={stale} compact meter={detailed} /></td>
            <td><MetricValue metric={vm.metrics.memoryUsagePercent ?? vm.metrics.memoryUsedBytes} stale={stale} series="memory" compact meter={detailed} /></td>
            {hasDisk && <td><MetricValue metric={vm.metrics.diskUsagePercent ?? vm.metrics.diskUsedBytes} stale={stale} series="disk" compact /></td>}
            {detailed && <><td><MetricValue metric={vm.metrics.uptimeSeconds} stale={stale} compact /></td><td><time dateTime={vm.evidence.observedAt ?? undefined}>{timestamp(vm.evidence.observedAt)}</time></td></>}
          </tr>)}</tbody></table></div> : <p className="panel-empty">Nenhuma VM informada na coleta atual.</p>}
        </div>
      </div>
      <footer className="panel-foot asgard-foot"><div className="metric-legend" aria-label="Legenda das métricas"><span>CPU</span><span>RAM</span><span>Disco</span></div><p>{number(running)} em execução de {number(vms.length)} VMs{unknown > 0 && ` · ${number(unknown)} sem estado atual`}</p>{detailed && <p>Perspectiva do hipervisor · valores atuais · as cores identificam métricas, não severidade. Storages não são somados; disco da VM não representa ocupação interna do sistema operacional.</p>}</footer>
    </>}
  </section>;
}
