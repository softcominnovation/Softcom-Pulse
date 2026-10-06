import Link from "next/link";
import { ArrowRight, HardDrive, Server } from "lucide-react";
import { useContext } from "react";
import type { AsgardSummary, VirtualMachine } from "@/lib/monitoring/contracts";
import { number, timestamp } from "@/lib/dashboard/format";
import { VmTable } from "@/components/infrastructure/host-panels";
import { EvidenceTimeContext, MetricValue, Status } from "./metrics";

function evidenceOld(vm: { evidence: VirtualMachine["evidence"] }, stale: boolean, now: number) {
  return stale || !vm.evidence.observedAt || !!vm.evidence.validUntil && Date.parse(vm.evidence.validUntil) < now;
}

export function AsgardPanel({ data, stale, detailed = false }: { data: AsgardSummary; stale: boolean; detailed?: boolean }) {
  const { host, vms } = data, now = useContext(EvidenceTimeContext);
  const running = vms.filter(vm => vm.state === "running" && !evidenceOld(vm, stale, now)).length;
  const unknown = vms.filter(vm => vm.state === "unknown" || evidenceOld(vm, stale, now)).length;
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
          <VmTable vms={vms} stale={stale} detailed={detailed} />
        </div>
      </div>
      <footer className="panel-foot asgard-foot"><div className="metric-legend" aria-label="Legenda das métricas"><span>CPU</span><span>RAM</span><span>Disco</span></div><p>{number(running)} em execução de {number(vms.length)} VMs{unknown > 0 && ` · ${number(unknown)} sem estado atual`}</p>{detailed && <p>Perspectiva do hipervisor · valores atuais · as cores identificam métricas, não severidade. Storages não são somados; disco da VM não representa ocupação interna do sistema operacional.</p>}</footer>
    </>}
  </section>;
}
