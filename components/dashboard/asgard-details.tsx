"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { ArrowLeft, Server } from "lucide-react";
import { asgardUrl, detailQuerySchema, selectHypervisor } from "@/lib/infrastructure/navigation";
import { EvidenceClock, ReadNotice, useHosts, useProblems } from "@/components/infrastructure/data";
import { DevicePanel, HostKpis, MetricList, VmStateSummary, VmTable } from "@/components/infrastructure/host-panels";
import { HistoryPanel, RangeControls } from "@/components/infrastructure/history-panel";
import { HistoryCache } from "@/components/infrastructure/use-history";
import { ProblemsPanel } from "@/components/infrastructure/problems-panel";
import { VmDetails } from "@/components/infrastructure/vm-details";

export function AsgardDetails({ query }: { query: Record<string, string | string[] | undefined> }) {
  const parsed = detailQuerySchema.safeParse(query);
  return <EvidenceClock><HistoryCache>{parsed.success ? <AsgardContent selection={parsed.data} /> : <div className="detail-not-found" role="alert"><h1>Parâmetros inválidos</h1><p>Confira o host, a VM e o período informados no endereço.</p><Link href="/asgard">Voltar ao ASGARD</Link></div>}</HistoryCache></EvidenceClock>;
}
function AsgardContent({ selection }: { selection: { hostKey?: string; vm?: string; range: "1h" | "24h" | "7d" } }) {
  const router = useRouter(), hosts = useHosts(), problems = useProblems();
  const result = hosts.data, host = result ? selectHypervisor(result, selection.hostKey) : undefined;
  const vm = host?.vms.find(item => item.vmKey === selection.vm && item.parentHostKey === host.hostKey);
  const stale = hosts.failed || !!result?.stale;
  const [lastVm, setLastVm] = useState<{ parent: string; key: string; name: string } | null>(null);
  if (vm && host && (lastVm?.parent !== host.hostKey || lastVm.key !== vm.vmKey || lastVm.name !== vm.name)) setLastVm({ parent: host.hostKey, key: vm.vmKey, name: vm.name });
  const selectRef = useRef<HTMLSelectElement>(null), restoreFocus = useRef(false);
  useEffect(() => {
    if (restoreFocus.current) { selectRef.current?.focus({ preventScroll: true }); restoreFocus.current = false; }
  }, [selection.vm]);
  const agent = vm?.linuxHostKey ? result?.data.find(item => item.hostKey === vm.linuxHostKey && item.role === "linux") : undefined;
  const invalidVm = !!host && !!selection.vm && !vm;
  const navigate = (vmKey: string | undefined, range = selection.range) => router.push(asgardUrl(host!.hostKey, vmKey, range), { scroll: false });
  const controls = host && <><label className="resource-select-label" htmlFor="resource-select">Host ou VM do gráfico<select ref={selectRef} id="resource-select" value={selection.vm ?? ""} onChange={event => { restoreFocus.current = true; navigate(event.target.value || undefined); }}><option value="">{host.name} · host</option>{host.vms.map(item => <option key={item.vmKey} value={item.vmKey}>VM {item.vmId ?? "—"} · {item.name}</option>)}</select></label><RangeControls range={selection.range} onChange={range => navigate(selection.vm, range)} /></>;
  return <div className="infrastructure-details asgard-details">
    <Link className="details-back" href={selection.vm && host ? asgardUrl(host.hostKey, undefined, selection.range) : "/"}><ArrowLeft aria-hidden="true" />{selection.vm && host ? `Voltar ao ${host.name}` : "Voltar ao dashboard"}</Link>
    <div className="dashboard-heading"><div><h1>{selection.vm ? vm ? `Detalhes da VM · ${vm.name}` : "Detalhes da VM" : `Detalhes do ${host?.name ?? "ASGARD"}`}</h1><p className="dashboard-subtitle">{selection.vm ? "Capacidade, métricas e histórico da máquina virtual selecionada." : "Armazenamento, capacidade e histórico do hipervisor."}</p></div></div>
    <ReadNotice result={result} failed={hosts.failed} refresh={hosts.refresh} label={selection.vm ? "VM" : "ASGARD"} />
    {result && !host && <section className="dashboard-panel"><div className="panel-empty" role="status"><h2>{selection.hostKey ? "Hipervisor não encontrado" : "Selecione um hipervisor"}</h2><p>{selection.hostKey ? "O recurso não está disponível no escopo atual." : "Não há uma seleção única disponível na coleta atual."}</p><ul>{result.data.filter(item => item.role === "hypervisor").map(item => <li key={item.hostKey}><Link href={asgardUrl(item.hostKey)}>{item.name}</Link></li>)}</ul><Link href="/infraestrutura">Ver infraestrutura</Link></div></section>}
    {host && <>
      {invalidVm && <div className="detail-not-found" role="alert"><h2>VM não encontrada</h2>{lastVm?.parent === host.hostKey && lastVm.key === selection.vm && <p>Última identificação: {lastVm.name} · {host.name}.</p>}<p>A VM selecionada não está disponível neste host. Ela pode ter saído da coleta ou estar fora do escopo operacional.</p><Link href={asgardUrl(host.hostKey, undefined, selection.range)}>Voltar ao host</Link></div>}
      {!selection.vm && <><HostKpis host={host} stale={stale} /><div className="asgard-detail-layout">
        <div className="asgard-storage"><DevicePanel title={`Armazenamento de ${host.name}`} devices={host.storages} stale={stale} /><VmStateSummary vms={host.vms} stale={stale} /></div>
        <div className="asgard-host-history"><HistoryPanel resource={{ type: "host", hostKey: host.hostKey, reference: null }} range={selection.range} name={host.name} host={host} origin="Hipervisor · Zabbix" controls={controls} /></div>
      </div></>}
      {vm && <VmDetails key={`${host.hostKey}:${vm.vmKey}`} vm={vm} agent={agent} parentName={host.name} range={selection.range} stale={stale} controls={controls} />}
      <section className="dashboard-panel vm-detail-panel"><div className="panel-heading"><Server aria-hidden="true" /><h2>VMs dentro de {host.name}</h2></div><p className="history-origin">Selecione uma VM pelo nome para consultar seu histórico. Role a tabela para alcançar todas as colunas.</p><VmTable vms={host.vms} hosts={result?.data} stale={stale} detailed selected={vm?.vmKey} range={selection.range} /><p className="panel-foot">Disco provisionado, filesystem e ocupação de pools são medidas distintas. Histórico consultado somente para os recursos exibidos.</p></section>
      {!selection.vm && <><div className="detail-two-columns"><section className="dashboard-panel"><div className="panel-heading"><Server aria-hidden="true" /><h2>{host.name} · outras métricas atuais</h2></div><MetricList metrics={host.metrics} stale={stale} /></section><DevicePanel title="Rede por interface" devices={host.interfaces} stale={stale} network /></div><ProblemsPanel poll={problems} hostKeys={[host.hostKey]} /></>}
      {vm && <ProblemsPanel poll={problems} hostKeys={agent ? [agent.hostKey] : []} vm={vm} />}
    </>}
  </div>;
}
