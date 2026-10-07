"use client";

import { displayName } from "@/lib/monitoring/display-names";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, Server } from "lucide-react";
import { historyRangeSchema, hostKeySchema } from "@/lib/config/resources";
import { asgardUrl, hostUrl } from "@/lib/infrastructure/navigation";
import { EvidenceClock, ReadNotice, useHost, useProblems } from "./data";
import { DevicePanel, HostKpis, MetricList } from "./host-panels";
import { HistoryPanel, RangeControls } from "./history-panel";
import { HistoryCache } from "./use-history";
import { ProblemsPanel } from "./problems-panel";
import { HostContainers } from "@/components/services/container-inventory";

export function HostDetails({ hostKey, range }: { hostKey: string; range?: string | string[] }) {
  const parsedKey = hostKeySchema.safeParse(hostKey), parsedRange = historyRangeSchema.default("24h").safeParse(range);
  if (!parsedKey.success || !parsedRange.success) return <div className="detail-not-found" role="alert"><h1>Parâmetros inválidos</h1><Link href="/infraestrutura">Voltar à infraestrutura</Link></div>;
  return <EvidenceClock><HistoryCache><HostContent hostKey={parsedKey.data} range={parsedRange.data} /></HistoryCache></EvidenceClock>;
}
function HostContent({ hostKey, range }: { hostKey: string; range: "1h" | "24h" | "7d" }) {
  const poll = useHost(hostKey), problems = useProblems(), router = useRouter();
  const host = poll.data?.data, stale = poll.failed || !!poll.data?.stale;
  return <div className="infrastructure-details"><Link className="details-back" href="/infraestrutura"><ArrowLeft aria-hidden="true" />Voltar à infraestrutura</Link><div className="dashboard-heading"><div><h1>{host?.displayName ?? host?.name ?? "Detalhes do host"}</h1><p className="dashboard-subtitle">Perspectiva do Agent · métricas internas, filesystems e interfaces.</p></div></div>
    <ReadNotice result={poll.data} failed={poll.failed} refresh={poll.refresh} label="host" />
    {!host && poll.failed && <p className="panel-empty">Host não encontrado ou indisponível no escopo atual.</p>}
    {host && (host.role !== "linux" ? <div className="detail-not-found"><p>Este recurso não é um host Linux com perspectiva Agent.</p>{host.role === "hypervisor" && <Link href={asgardUrl(host.hostKey, undefined, range)}>Abrir detalhe do hipervisor</Link>}</div> : <>
      <HostKpis host={host} stale={stale} />
      <HistoryPanel resource={{ type: "host", hostKey, reference: null }} range={range} name={displayName(host)} host={host} origin="Linux · Agent · métricas internas" controls={<RangeControls range={range} onChange={value => router.push(hostUrl(hostKey, value), { scroll: false })} />} />
      <div className="detail-two-columns"><DevicePanel title="Filesystems" devices={host.filesystems} stale={stale} /><DevicePanel title="Rede por interface" devices={host.interfaces} stale={stale} network /></div>
      <section className="dashboard-panel"><div className="panel-heading"><Server aria-hidden="true" /><h2>Métricas atuais do Agent</h2></div><MetricList metrics={host.metrics} stale={stale} /></section><HostContainers hostKey={hostKey} /><ProblemsPanel poll={problems} hostKeys={[hostKey]} />
    </>)}
  </div>;
}
