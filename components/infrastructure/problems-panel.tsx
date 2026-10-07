"use client";

import { TriangleAlert } from "lucide-react";
import { timestamp } from "@/lib/dashboard/format";
import { SeverityPill } from "@/components/services/states";
import { Button } from "@/components/ui/button";
import type { useProblems } from "./data";
import type { VirtualMachine } from "@/lib/monitoring/contracts";

export function ProblemsPanel({ poll, hostKeys, vm, title }: { poll: ReturnType<typeof useProblems>; hostKeys?: string[]; vm?: VirtualMachine; title?: string }) {
  const items = [...poll.data?.data ?? []].filter(item => !hostKeys || hostKeys.includes(item.resource.hostKey) || !!vm && item.resource.type === "vm" && item.resource.hostKey === vm.parentHostKey && item.resource.reference === vm.vmKey).sort((a, b) => b.severity - a.severity || b.startedAt.localeCompare(a.startedAt));
  return <section className="dashboard-panel detail-problems"><div className="panel-heading"><TriangleAlert aria-hidden="true" /><h2>{title ?? (vm ? "Problemas da VM" : "Problemas da infraestrutura")}</h2></div>
    {poll.failed && <div className="history-error" role="alert">Falha ao atualizar problemas. A última evidência disponível pode estar desatualizada.<Button onClick={poll.refresh}>Tentar novamente</Button></div>}
    {poll.data?.stale && <p className="history-warning">Problemas com evidência desatualizada.</p>}
    {items.length ? <ul className="problem-list" tabIndex={0}>{items.map(item => <li key={item.id}><SeverityPill severity={item.severity} /><div><p title={item.description}>{item.displayDescription ?? item.description}</p><small>{item.resourceDisplayName ?? item.resource.hostKey}</small>{item.displayDescription && item.displayDescription !== item.description && <details><summary>Descrição da origem</summary><p>{item.description}</p></details>}</div><time dateTime={item.startedAt}>{timestamp(item.startedAt)}</time></li>)}</ul> : <p className="panel-empty">{poll.loading ? "Carregando problemas…" : poll.failed || poll.data?.stale || poll.data?.availability !== "ready" ? "Sem evidência atual de problemas." : vm ? "Nenhum problema ativo informado para esta VM." : "Nenhum problema ativo informado para estes hosts."}</p>}
  </section>;
}
