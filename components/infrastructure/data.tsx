"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import { z } from "zod";
import { api } from "@/lib/client/api";
import { containerSchema, hostSchema, problemSchema, type ReadResult } from "@/lib/monitoring/contracts";
import type { HostsResult } from "@/lib/infrastructure/navigation";
import { timestamp } from "@/lib/dashboard/format";
import { usePoll } from "@/components/dashboard/use-poll";
import { EvidenceTimeContext } from "@/components/dashboard/metrics";
import { Button } from "@/components/ui/button";
import { RefreshCw } from "lucide-react";

export function readSchema<T>(schema: z.ZodType<T>) {
  return z.object({ data: schema, availability: z.enum(["ready", "no_data", "unavailable"]), stale: z.boolean(), lastUpdated: z.iso.datetime({ offset: true }).nullable(), refreshAfterMs: z.number().finite().min(1000) });
}
const hostsResultSchema = readSchema(hostSchema.array()).extend({ asgardHostKey: z.string().nullable().optional() });
const delay = (value: { refreshAfterMs: number }) => value.refreshAfterMs;
export function useHosts() {
  const load = useCallback(async (signal: AbortSignal): Promise<HostsResult> => hostsResultSchema.parse((await api.get("/monitoring/hosts", { signal })).data), []);
  return usePoll("infrastructure-hosts", load, delay, "Não foi possível atualizar os hosts. Confira a última evidência disponível.");
}
export function useHost(hostKey: string | null) {
  const load = useCallback(async (signal: AbortSignal) => {
    const result = readSchema(hostSchema).parse((await api.get(`/monitoring/hosts/${encodeURIComponent(hostKey!)}`, { signal })).data);
    if (result.data.hostKey !== hostKey) throw new Error("Unexpected host identity");
    return result;
  }, [hostKey]);
  return usePoll(hostKey, load, delay, "Não foi possível atualizar este host. Confira a última evidência disponível.");
}
export function useProblems() {
  const load = useCallback(async (signal: AbortSignal) => readSchema(problemSchema.array()).parse((await api.get("/monitoring/problems", { signal })).data), []);
  return usePoll("infrastructure-problems", load, delay, "Não foi possível atualizar os problemas da infraestrutura.");
}
export function useHostContainers(hostKey: string | null) {
  const load = useCallback(async (signal: AbortSignal) => {
    const result = readSchema(containerSchema.array()).parse((await api.get(`/monitoring/hosts/${encodeURIComponent(hostKey!)}/containers`, { signal })).data);
    if (result.data.some(item => item.hostKey !== hostKey)) throw new Error("Unexpected container host");
    return result;
  }, [hostKey]);
  return usePoll(hostKey, load, delay, "Não foi possível atualizar os containers desta VM.");
}
export function EvidenceClock({ children }: { children: ReactNode }) {
  const [now, setNow] = useState(0);
  useEffect(() => { const update = () => setNow(Date.now()); update(); const timer = setInterval(update, 1000); return () => clearInterval(timer); }, []);
  return <EvidenceTimeContext value={now}>{children}</EvidenceTimeContext>;
}
export function ReadNotice({ result, failed, refresh, label }: { result: ReadResult<unknown> | null; failed: boolean; refresh: () => void; label: string }) {
  const warning = failed || result?.stale || result?.availability === "unavailable";
  return <div className={`dashboard-banner banner-${warning ? "warn" : "unknown"}`} role={warning ? "alert" : "status"}>
    <div><strong>{failed ? "Falha na atualização" : result?.stale ? "Dados desatualizados" : !result ? "Carregando monitoramento" : result.availability !== "ready" ? "Aguardando dados do monitoramento" : "Última leitura disponível"}</strong><p>{failed ? result ? "A última leitura foi mantida; não confirma o estado atual." : "Não foi possível obter a leitura. Tente novamente." : "Confira a qualidade e o horário de cada evidência. Uma nova coleta não renova uma amostra antiga."}</p></div>
    <div className="banner-update"><span>Última atualização</span><time dateTime={result?.lastUpdated ?? undefined}>{timestamp(result?.lastUpdated)}</time></div><Button onClick={refresh} aria-label={`Atualizar ${label}`}><RefreshCw aria-hidden="true" /><span>Atualizar</span></Button>
  </div>;
}
