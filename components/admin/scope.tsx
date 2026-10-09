"use client";

import { useEffect, useMemo, useState } from "react";
import { z } from "zod";
import { toast } from "sonner";
import { api } from "@/lib/client/api";
import { Button } from "@/components/ui/button";
import { ConfirmationDialog } from "@/components/confirmation-dialog";
import { useCanEdit } from "@/store/auth.store";
import { Field, ReadError, errorText, useAdminRead, useMutation } from "./shared";

const suggestedVmSchema = z.strictObject({
  parentHostKey: z.string(),
  vmId: z.string(),
  vmKey: z.string(),
  vmName: z.string(),
  match: z.enum(["exact_name", "tags"]),
});
const documentSchema = z.object({
  data: z.object({
    asgardHostKey: z.string(),
    revision: z.number().int(),
    hostKeys: z.array(z.string()),
    vmLinks: z.array(z.object({ hostKey: z.string(), parentHostKey: z.string(), vmId: z.string() })),
    hosts: z.array(z.object({
      hostKey: z.string(),
      displayName: z.string(),
      role: z.enum(["hypervisor", "agent"]),
      linkedVm: z.object({ parentHostKey: z.string(), vmId: z.string(), vmName: z.string() }).nullable(),
    })),
    candidates: z.array(z.object({
      hostKey: z.string(),
      displayName: z.string(),
      agentAvailable: z.literal(true),
      suggestedVm: suggestedVmSchema.nullable(),
    })),
    unlinkedVms: z.array(z.object({
      parentHostKey: z.string(),
      vmId: z.string(),
      vmKey: z.string(),
      vmName: z.string(),
    })),
    discoveryStatus: z.enum(["ready", "stale", "unavailable", "no_data"]),
    discoveryUpdatedAt: z.string().nullable(),
  }),
  availability: z.enum(["ready", "no_data", "unavailable"]),
  stale: z.boolean(),
  lastUpdated: z.string().nullable(),
  refreshAfterMs: z.number(),
});

function parseDocument(data: unknown) {
  return documentSchema.parse(data);
}

function matchLabel(match: "exact_name" | "tags") {
  return match === "tags" ? "tags Pulse" : "nome igual";
}

/** Escopo Zabbix section for /admin/recursos. Visible only to editors. */
export function ScopeSection() {
  const canEdit = useCanEdit();
  const scope = useAdminRead("/settings/monitoring-scope", parseDocument);
  const mutation = useMutation();
  const [choices, setChoices] = useState<Record<string, string>>({});
  const data = scope.data?.data;
  const asgard = useMemo(() => data?.hosts.find(host => host.role === "hypervisor"), [data]);
  const agents = useMemo(() => data?.hosts.filter(host => host.role === "agent") ?? [], [data]);
  const candidates = useMemo(
    () => (data?.candidates ?? []).filter(item => !data!.hostKeys.includes(item.hostKey)),
    [data],
  );
  const refreshScope = scope.refresh;
  const refreshAfterMs = scope.data?.refreshAfterMs ?? 20000;

  useEffect(() => {
    if (!canEdit) return;
    const tick = () => { if (!document.hidden) refreshScope(); };
    const timer = setInterval(tick, refreshAfterMs);
    document.addEventListener("visibilitychange", tick);
    return () => { clearInterval(timer); document.removeEventListener("visibilitychange", tick); };
  }, [canEdit, refreshScope, refreshAfterMs]);

  if (!canEdit) return null;

  const link = async (hostKey: string, parentHostKey: string, vmId: string) => {
    if (!data) return;
    try {
      await mutation.run(async signal => {
        await api.post("/settings/monitoring-scope/links", { hostKey, parentHostKey, vmId, expectedRevision: data.revision }, { signal });
      });
      toast.success("Escopo atualizado. A coleta inclui este Agent no próximo ciclo.");
      scope.refresh();
    } catch (error) { toast.error(errorText(error)); }
  };

  const unlink = async (hostKey: string, removeHost: boolean) => {
    if (!data) return;
    try {
      await mutation.run(async signal => {
        await api.delete("/settings/monitoring-scope/links", { data: { hostKey, expectedRevision: data.revision, removeHost }, signal });
      });
      toast.success(removeHost ? "Agent removido do escopo do Pulse." : "Vínculo com a VM removido.");
      scope.refresh();
    } catch (error) { toast.error(errorText(error)); }
  };

  return <>
    <header className="admin-heading">
      <h2>Escopo Zabbix</h2>
      <p>Hosts que o Pulse coleta e Agents prontos no Zabbix ainda sem vínculo.</p>
    </header>
    <section className="dashboard-panel">
      <div className="panel-heading"><h3>No Pulse</h3><Button onClick={scope.refresh}>Atualizar</Button></div>
      {scope.failed && <ReadError refresh={scope.refresh}>Não foi possível ler o escopo.</ReadError>}
      {scope.loading && !data && <p className="panel-empty">Carregando escopo…</p>}
      {data && (data.discoveryStatus === "stale" || data.discoveryStatus === "unavailable") && <p className="admin-notice" role="status">Lista de Agents novos desatualizada. O escopo atual continua editável.</p>}
      {data && <ul className="admin-saved-list">
        {asgard && <li><div><strong>{asgard.displayName}</strong><p>{asgard.hostKey} · Hipervisor</p></div></li>}
        {agents.map(host => <li key={host.hostKey}><div><strong>{host.displayName}</strong><p>{host.hostKey} · {host.linkedVm ? `${host.linkedVm.vmName} · ${host.linkedVm.vmId}` : "Sem VM associada"}</p></div>
          <div className="admin-actions">
            {host.linkedVm && <ConfirmationDialog trigger={<Button disabled={mutation.busy}>Desassociar</Button>} title="Parar de coletar o vínculo deste Agent com a VM?" description="O host no Zabbix não será alterado. O Agent permanece no escopo até você removê-lo." confirmLabel="Desassociar VM" onConfirm={() => unlink(host.hostKey, false)} />}
            <ConfirmationDialog trigger={<Button disabled={mutation.busy}>Remover do escopo</Button>} title="Remover este Agent do escopo do Pulse?" description="A coleta deixa de incluir o host. O cadastro no Zabbix não muda." confirmLabel="Remover do escopo" destructive onConfirm={() => unlink(host.hostKey, true)} />
          </div>
        </li>)}
      </ul>}
    </section>
    <section className="dashboard-panel">
      <div className="panel-heading"><h3>Disponíveis para vincular</h3></div>
      {data && !candidates.length && <p className="panel-empty">Nenhum Agent novo pronto no Zabbix. Quando o Agent responder, aparece aqui.</p>}
      {data && !!candidates.length && <ul className="admin-saved-list">{candidates.map(candidate => {
        const selected = choices[candidate.hostKey] ?? (candidate.suggestedVm ? `${candidate.suggestedVm.parentHostKey}|${candidate.suggestedVm.vmId}` : "");
        const [parentHostKey, vmId] = selected.split("|");
        return <li key={candidate.hostKey}><div>
          <strong>Agent: {candidate.displayName}</strong>
          <p>{candidate.hostKey} · Disponível para vincular</p>
          {candidate.suggestedVm ? <p>VM sugerida: {candidate.suggestedVm.vmName} ({candidate.suggestedVm.vmId}) · {matchLabel(candidate.suggestedVm.match)}</p>
            : <Field label="VM do Asgard"><select value={selected} onChange={event => setChoices(current => ({ ...current, [candidate.hostKey]: event.target.value }))}><option value="">Escolha a VM</option>{data.unlinkedVms.map(vm => <option key={vm.vmKey} value={`${vm.parentHostKey}|${vm.vmId}`}>{vm.vmName} · {vm.vmId}</option>)}</select></Field>}
        </div>
          <div className="admin-actions"><Button variant="primary" disabled={mutation.busy || !parentHostKey || !vmId} onClick={() => link(candidate.hostKey, parentHostKey, vmId)}>Associar ao Pulse</Button></div>
        </li>;
      })}</ul>}
    </section>
  </>;
}
