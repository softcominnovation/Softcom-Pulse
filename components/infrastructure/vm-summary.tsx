"use client";

import { useContext } from "react";
import type { Host, VirtualMachine } from "@/lib/monitoring/contracts";
import { isOld, number, qualityText, timestamp } from "@/lib/dashboard/format";
import { EvidenceTimeContext, MetricValue } from "@/components/dashboard/metrics";

type Props = { vm: VirtualMachine; agent?: Host; stale: boolean };
export function VmCpuCount({ vm, stale }: Pick<Props, "vm" | "stale">) {
  const now = useContext(EvidenceTimeContext);
  const metric = vm.metrics.provisionedCpuCount;
  const known = metric?.unit === "count" && metric.value !== null && Number.isSafeInteger(metric.value) && metric.value > 0 && ["fresh", "stale"].includes(metric.quality);
  const old = isOld(metric, stale, now);
  return <small className={`vm-cpu-count${old && known ? " metric-old" : ""}`} title={`vCPUs provisionadas · ${qualityText(metric, stale, now)} · ${timestamp(metric?.observedAt)}`}>
    {known ? `${number(metric.value)} vCPUs` : "vCPUs: —"}
  </small>;
}
export function VmAgentSummary({ vm, agent, stale }: Props) {
  if (!vm.linuxHostKey) return <small>Sem Agent associado</small>;
  if (!agent || agent.hostKey !== vm.linuxHostKey || agent.role !== "linux") return <small>Agent sem leitura</small>;
  const root = agent.filesystems.find(fs => fs.name === "/");
  return <div className="vm-agent-summary">
    {root ? <MetricValue metric={root.metrics.diskUsagePercent ?? root.metrics.diskUsedBytes} stale={stale} series="disk" compact /> : <small>Raiz sem leitura</small>}
    <small>{root && "Raiz / · "}{number(agent.filesystems.length)} {agent.filesystems.length === 1 ? "filesystem" : "filesystems"}</small>
  </div>;
}
