"use client";

import { displayName } from "@/lib/monitoring/display-names";

import Link from "next/link";
import { useContext, useRef, useState, type ReactNode } from "react";
import { Activity, Box, HardDrive, Server } from "lucide-react";
import type { Host, VirtualMachine } from "@/lib/monitoring/contracts";
import { number } from "@/lib/dashboard/format";
import { evidenceExpired, hostUrl, type WindowRange } from "@/lib/infrastructure/navigation";
import { EvidenceTimeContext, MetricValue, Status } from "@/components/dashboard/metrics";
import { Button } from "@/components/ui/button";
import { useHostContainers } from "./data";
import { DevicePanel, MetricList } from "./host-panels";
import { HistoryPanel } from "./history-panel";
import { VmNameEditor } from "@/components/admin/vms";
import { VmCpuCount } from "./vm-summary";

function VmKpis({ vm, agent, stale }: { vm: VirtualMachine; agent?: Host; stale: boolean }) {
  const now = useContext(EvidenceTimeContext);
  const containers = useHostContainers(agent?.hostKey ?? null), result = containers.data;
  const root = agent?.filesystems.find(device => device.name === "/");
  const currentContainers = result?.data.filter(item => item.status !== "unknown" && !evidenceExpired(item, false, now)) ?? [];
  const hasCurrentContainers = !!result && result.availability === "ready" && !result.stale && !containers.failed && !stale && currentContainers.length > 0;
  const running = currentContainers.filter(item => item.status === "running").length;
  const containerMessage = !vm.linuxHostKey ? "Agent ainda não disponível para esta VM." : !agent ? "Agent associado sem dados na coleta atual." : containers.failed ? "Falha ao consultar os containers desta VM." : !result ? "Carregando containers…" : stale || result.stale ? "Evidência desatualizada; execução não confirmada." : result.availability !== "ready" ? "Sem dados de containers na coleta atual." : !result.data.length ? "Nenhum container individualizado na descoberta." : !hasCurrentContainers ? "Sem evidência atual dos containers." : `${number(result.data.length)} individualizados pelo Zabbix · ${number(currentContainers.length)} com estado atual`;
  return <section className="dashboard-kpis host-kpis vm-kpis" aria-label={`Indicadores da VM ${displayName(vm)}`}>
    <article className="dashboard-kpi"><div className="kpi-label"><h2>CPU da VM</h2><Server aria-hidden="true" /></div><MetricValue metric={vm.metrics.cpuUsagePercent} stale={stale} compact /><VmCpuCount vm={vm} stale={stale} /><p>Uso no hipervisor</p></article>
    <article className="dashboard-kpi"><div className="kpi-label"><h2>Memória da VM</h2><Activity aria-hidden="true" /></div><MetricValue metric={vm.metrics.memoryUsagePercent ?? vm.metrics.memoryUsedBytes} stale={stale} series="memory" compact /><p>Usada / total</p><div className="vm-kpi-capacity"><MetricValue metric={vm.metrics.memoryUsedBytes} stale={stale} compact /><span>/</span><MetricValue metric={vm.metrics.memoryTotalBytes} stale={stale} compact /></div></article>
    <article className="dashboard-kpi"><div className="kpi-label"><h2>Armazenamento da VM</h2><HardDrive aria-hidden="true" /></div><MetricValue metric={root ? root.metrics.diskUsagePercent ?? root.metrics.diskUsedBytes : vm.metrics.diskTotalBytes} stale={stale} series="disk" compact /><p>{root ? "Filesystem raiz / · Agent" : "Capacidade do disco virtual · hipervisor"}</p>{root ? <div className="vm-kpi-capacity"><MetricValue metric={root.metrics.diskUsedBytes} stale={stale} compact /><span>/</span><MetricValue metric={root.metrics.diskTotalBytes} stale={stale} compact /></div> : <p>{vm.linuxHostKey ? "Uso interno da raiz sem leitura disponível." : "Uso interno depende do Agent."}</p>}</article>
    <article className="dashboard-kpi vm-container-kpi"><div className="kpi-label"><h2>Containers em execução</h2><Box aria-hidden="true" /></div><p className="kpi-value">{hasCurrentContainers ? number(running) : "—"}</p><p role="status">{containerMessage}</p>{containers.failed && agent && <Button onClick={containers.refresh}>Tentar novamente</Button>}</article>
  </section>;
}

export function VmDetails({ vm, agent, parentName, range, stale, controls }: { vm: VirtualMachine; agent?: Host; parentName: string; range: WindowRange; stale: boolean; controls: ReactNode }) {
  const editNameButton = useRef<HTMLButtonElement>(null);
  const [agentOpened, setAgentOpened] = useState(false), [editingName, setEditingName] = useState(false);
  const now = useContext(EvidenceTimeContext);
  const promoted = ["cpuUsagePercent", "provisionedCpuCount", "memoryUsagePercent", "memoryUsedBytes", "memoryTotalBytes"];
  if (!agent?.filesystems.some(device => device.name === "/")) promoted.push("diskTotalBytes");
  const metrics = Object.fromEntries(Object.entries(vm.metrics).filter(([key]) => !promoted.includes(key)));
  return <>
    <VmKpis vm={vm} agent={agent} stale={stale} />
    <section className="vm-identity-panel"><div className="vm-identity-heading"><p>{displayName(vm) !== vm.name && <>Nome técnico: {vm.name} · </>}ID {vm.vmId ?? "não informado"}</p><Button ref={editNameButton} aria-expanded={editingName} onClick={() => setEditingName(value => !value)}>Editar nome</Button></div>{editingName && <VmNameEditor vm={vm} canCreate={!stale} onClose={() => { setEditingName(false); editNameButton.current?.focus(); }} />}</section>
    <HistoryPanel resource={{ type: "vm", hostKey: vm.parentHostKey, reference: vm.vmKey }} range={range} name={displayName(vm)} origin="VM · perspectiva do hipervisor" controls={controls} summary={<div className="selected-vm-current"><p className="history-origin">VM {vm.vmId ?? "sem ID informado"} · hipervisor {parentName} <Status value={vm.state} stale={evidenceExpired(vm, stale, now)} /></p><MetricList metrics={metrics} stale={stale} /></div>} />
    {vm.linuxHostKey && <section className="dashboard-panel agent-context"><Link href={hostUrl(vm.linuxHostKey, range)}>Detalhes do Agent</Link><details open={agentOpened} onToggle={event => setAgentOpened(event.currentTarget.open)}><summary>Perspectiva do Agent desta VM</summary>{agentOpened && (agent ? <><MetricList metrics={agent.metrics} stale={stale} /><DevicePanel title="Filesystems dentro da VM" devices={agent.filesystems} stale={stale} /><DevicePanel title="Rede da VM por interface" devices={agent.interfaces} stale={stale} network /><HistoryPanel resource={{ type: "host", hostKey: agent.hostKey, reference: null }} range={range} name={displayName(agent)} host={agent} origin="Linux · Agent · métricas internas" /></> : <p className="panel-empty">Agent associado sem dados disponíveis na coleta atual.</p>)}</details></section>}
  </>;
}
