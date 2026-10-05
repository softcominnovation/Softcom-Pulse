"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { ArrowLeft, RefreshCw } from "lucide-react";
import { api } from "@/lib/client/api";
import { hostSchema, type Host, type ReadResult } from "@/lib/monitoring/contracts";
import { timestamp } from "@/lib/dashboard/format";
import { Button } from "@/components/ui/button";
import { AsgardPanel } from "./asgard-panel";
import { EvidenceTimeContext } from "./metrics";
import { usePoll } from "./use-poll";

const delay = (result: ReadResult<Host[]>) => result.refreshAfterMs;
export function AsgardDetails({ hostKey }: { hostKey?: string }) {
  const [now, setNow] = useState(0);
  const load = useCallback(async (signal: AbortSignal) => {
    const result = (await api.get<ReadResult<Host[]>>("/monitoring/hosts", { signal })).data;
    if (!Number.isFinite(result.refreshAfterMs)) throw new Error("Invalid refresh interval");
    return { ...result, data: hostSchema.array().parse(result.data) };
  }, []);
  const poll = usePoll("asgard-hosts", load, delay, "Não foi possível atualizar o ASGARD. A última leitura permanece identificada na tela.");
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(timer); }, []);
  const result = poll.data;
  const host = result?.data.find(item => item.role === "hypervisor" && (!hostKey || item.hostKey === hostKey));
  return <div className="asgard-details">
    <Link className="details-back" href="/"><ArrowLeft aria-hidden="true" />Voltar ao dashboard</Link>
    <div className="dashboard-heading"><div><h1>Detalhes do ASGARD</h1><p className="dashboard-subtitle">Métricas atuais do hipervisor e máquinas virtuais · Zabbix</p></div><Button onClick={poll.refresh}><RefreshCw aria-hidden="true" />Atualizar ASGARD</Button></div>
    <div className={`dashboard-banner banner-${poll.failed || result?.stale ? "warn" : "unknown"}`} role={poll.failed || result?.stale ? "alert" : "status"}>
      <div><strong>{poll.failed ? "Falha na atualização" : result?.stale ? "Dados desatualizados" : !result ? "Carregando ASGARD" : !host ? "Hipervisor sem dados" : "Última leitura do ASGARD"}</strong><p>{poll.failed ? result ? "A última leitura foi mantida; não confirma o estado atual." : "Não foi possível obter os dados. Tente atualizar novamente." : "Confira a qualidade e o horário de cada evidência; a coleta não renova uma amostra antiga."}</p></div>
      <div className="banner-update"><span>Última atualização</span><time dateTime={result?.lastUpdated ?? undefined}>{timestamp(result?.lastUpdated)}</time></div>
    </div>
    {result && <EvidenceTimeContext value={now}><AsgardPanel data={{ host: host ?? null, vms: host?.vms ?? [] }} stale={poll.failed || result.stale} detailed /></EvidenceTimeContext>}
  </div>;
}
