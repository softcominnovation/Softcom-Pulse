"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/client/api";
import { serviceCandidateKind, suggestServicePrefix } from "@/lib/signal/service-prefix";
import { Button } from "@/components/ui/button";
import { ConfirmationDialog } from "@/components/confirmation-dialog";
import { TargetNotificationSettings } from "@/components/notifications/settings";
import { Check, Field, errorText, useMutation } from "@/components/admin/shared";
import { requestCanceled } from "@/lib/client/request-canceled";

export type ClusterService = {
  id: string; displayName: string; servicePrefix: string; enabled: boolean; dashboardEnabled: boolean;
  panelEnabled: boolean; flowKpi: "database" | "redis" | null; critical: boolean; displayOrder: number; revision: number;
  kpiLabel: string; tone: string; vmName: string | null; hostKey: string | null; reason: string;
};

const empty = { displayName: "", servicePrefix: "", enabled: true, dashboardEnabled: false, panelEnabled: true, flowKpi: "" as "" | "database" | "redis", critical: false, displayOrder: 0 };
type Candidate = { hostKey: string; name: string; suggestedPrefix: string };

function registeredCopy(prefix: string, services: ClusterService[]) {
  const existing = services.find(service => service.servicePrefix === prefix);
  return existing ? `O prefixo ${prefix} já está cadastrado neste Signal como ${existing.displayName}.` : "";
}

export function SignalClusterServices({ targetId, revision, services, editor, onSaved }: {
  targetId: string; revision: number; services: ClusterService[]; editor: boolean; onSaved: () => void;
}) {
  const params = useSearchParams();
  const focus = params.get("signalService");
  const mutation = useMutation();
  const [draft, setDraft] = useState(empty);
  const [notice, setNotice] = useState("");
  const [catalog, setCatalog] = useState<Candidate[]>([]);
  const [catalogNote, setCatalogNote] = useState("");
  const [catalogError, setCatalogError] = useState("");
  useEffect(() => {
    if (!focus) return;
    document.getElementById(`signal-service-${focus}`)?.scrollIntoView({ block: "nearest" });
  }, [focus, services]);
  useEffect(() => {
    if (!editor) return;
    const controller = new AbortController();
    api.get<{ data: Candidate[]; truncated: boolean }>(`/monitoring/signal-targets/${targetId}/services/candidates`, { signal: controller.signal }).then(response => {
      const seen = new Set<string>();
      const found = response.data.data.filter(row => {
        if (seen.has(row.suggestedPrefix) || !serviceCandidateKind(row.suggestedPrefix)) return false;
        seen.add(row.suggestedPrefix);
        return true;
      }).sort((a, b) => Number(serviceCandidateKind(a.suggestedPrefix) === "redis") - Number(serviceCandidateKind(b.suggestedPrefix) === "redis") || a.suggestedPrefix.localeCompare(b.suggestedPrefix));
      setCatalog(found);
      setCatalogError("");
      setCatalogNote(response.data.truncated ? "A lista de containers foi limitada. O prefixo ainda pode ser digitado." : "");
    }).catch(failure => {
      if (controller.signal.aborted || requestCanceled(failure)) return;
      setCatalog([]);
      setCatalogError(errorText(failure));
    });
    return () => controller.abort();
  }, [editor, targetId]);

  async function create() {
    setNotice("");
    const duplicate = registeredCopy(draft.servicePrefix.trim(), services);
    if (duplicate) { setNotice(duplicate); return; }
    try {
      await mutation.run(signal => api.post(`/monitoring/signal-targets/${targetId}/services`, {
        expectedTargetRevision: revision, ...draft, flowKpi: draft.flowKpi || null,
      }, { signal }));
      toast.success("Serviço do cluster adicionado.");
      setDraft(empty);
      onSaved();
    } catch (failure) { setNotice(errorText(failure)); }
  }
  async function save(service: ClusterService, patch: Partial<ClusterService> & { flowKpi?: "database" | "redis" | null }) {
    await mutation.run(signal => api.patch(`/monitoring/signal-targets/${targetId}/services/${service.id}`, {
      expectedTargetRevision: revision, expectedRevision: service.revision, ...patch,
    }, { signal }));
    toast.success("Serviço atualizado.");
    onSaved();
  }
  async function remove(service: ClusterService) {
    await mutation.run(signal => api.delete(`/monitoring/signal-targets/${targetId}/services/${service.id}`, {
      data: { expectedTargetRevision: revision, expectedRevision: service.revision }, signal,
    }));
    toast.success("Serviço removido.");
    onSaved();
  }
  const registered = new Set(services.map(service => service.servicePrefix));
  const options = catalog.filter(row => {
    if (registered.has(row.suggestedPrefix)) return false;
    const kind = serviceCandidateKind(row.suggestedPrefix);
    return !draft.flowKpi || kind === draft.flowKpi;
  });
  const visible = editor ? services : services.filter(service => service.enabled && service.panelEnabled);
  return <section className="signal-vm-links" aria-label="Serviços do cluster">
    <div className="panel-heading signal-linked-heading"><h3>Serviços do cluster</h3></div>
    <p className="admin-muted">Postgres, Redis e outros containers das VMs vinculadas. O vínculo é o nome do serviço, não o id da task. Sem enumeração completa do Docker, um container que some fica como Sem leitura, não como Fora.</p>
    {visible.length ? <ul className="signal-linked-grid">{visible.map(service => <li key={service.id} id={`signal-service-${service.id}`} className="signal-linked-card-wrap">
      <article className="availability-card signal-cluster-card" aria-current={focus === service.id ? "true" : undefined}>
        <span className={`availability-state tone-${service.tone}`}><i className="status-dot" />{service.kpiLabel}</span>
        <strong className="availability-name">{service.displayName}</strong>
        <span className="availability-description">{service.servicePrefix}</span>
        <span className="availability-footer"><span>{service.vmName ?? service.hostKey ?? "Sem container único"}</span><strong>{service.flowKpi === "database" ? "Banco" : service.flowKpi === "redis" ? "Redis" : "Fora dos KPIs"}</strong></span>
      </article>
      {editor && <div className="admin-actions">
        <Check label="Crítico"><input type="checkbox" checked={service.critical} onChange={event => void save(service, { critical: event.target.checked })} /></Check>
        <Check label="Card"><input type="checkbox" checked={service.dashboardEnabled} onChange={event => void save(service, { dashboardEnabled: event.target.checked })} /></Check>
        <Check label="Painel"><input type="checkbox" checked={service.panelEnabled} onChange={event => void save(service, { panelEnabled: event.target.checked })} /></Check>
        <Field label="Prefixo" hint="Nome estável do serviço, sem o id da task."><input key={`${service.id}:${service.revision}`} defaultValue={service.servicePrefix} onBlur={event => {
          const next = suggestServicePrefix(event.target.value.trim());
          event.currentTarget.value = next;
          if (!next || next === service.servicePrefix) return;
          const duplicate = services.find(item => item.id !== service.id && item.servicePrefix === next);
          if (duplicate) { setNotice(`O prefixo ${next} já está cadastrado neste Signal como ${duplicate.displayName}.`); event.currentTarget.value = service.servicePrefix; return; }
          void save(service, { servicePrefix: next }).catch(failure => setNotice(errorText(failure)));
        }} /></Field>
        <Field label="Bloco"><select value={service.flowKpi ?? ""} onChange={event => void save(service, { flowKpi: event.target.value === "database" || event.target.value === "redis" ? event.target.value : null })}>
          <option value="">Não mostrar</option><option value="database">Banco</option><option value="redis">Redis</option>
        </select></Field>
        <TargetNotificationSettings targetRef={`signal_service:${service.id}`} />
        <ConfirmationDialog
          trigger={<Button type="button" size="icon" variant="destructive" aria-label={`Remover ${service.displayName}`}><Trash2 aria-hidden="true" /></Button>}
          title="Remover serviço do cluster?"
          description="O cadastro sai do Signal. O histórico de notificações permanece, sem aviso de recuperação."
          confirmLabel="Remover"
          destructive
          onConfirm={() => remove(service)}
        />
      </div>}
    </li>)}</ul> : <p className="panel-empty">{editor ? "Nenhum serviço configurado. Os três KPIs do bloco continuam como estão." : "Nenhum serviço de dados configurado."}</p>}
    {editor && <div className="admin-form">
      <Field label="Bloco do Signal" hint="Banco lista os Postgres. Redis lista os Redis. Sem bloco, a lista mostra os dois."><select value={draft.flowKpi} onChange={event => {
        const flowKpi = event.target.value as typeof draft.flowKpi;
        setDraft(value => {
          const kind = serviceCandidateKind(value.servicePrefix);
          return { ...value, flowKpi, servicePrefix: kind && flowKpi && kind !== flowKpi ? "" : value.servicePrefix };
        });
      }}>
        <option value="">Não mostrar</option><option value="database">Banco</option><option value="redis">Redis</option>
      </select></Field>
      <Field label="Nome"><input value={draft.displayName} onChange={event => setDraft(value => ({ ...value, displayName: event.target.value }))} /></Field>
      <Field label="Prefixo do serviço" hint="Digite o nome estável ou escolha um container abaixo. postgres sozinho não seleciona o serviço da stack."><input value={draft.servicePrefix} onChange={event => setDraft(value => ({ ...value, servicePrefix: event.target.value }))} onBlur={event => setDraft(value => ({ ...value, servicePrefix: suggestServicePrefix(event.target.value) }))} /></Field>
      <Field label="Containers disponíveis" hint={catalogNote || (draft.flowKpi === "database" ? "Postgres das VMs vinculadas que ainda não foram cadastrados." : draft.flowKpi === "redis" ? "Redis das VMs vinculadas que ainda não foram cadastrados." : "Postgres e Redis das VMs vinculadas que ainda não foram cadastrados.")} error={catalogError || undefined}><select value={options.some(option => option.suggestedPrefix === draft.servicePrefix) ? draft.servicePrefix : ""} onChange={event => {
        const prefix = event.target.value;
        if (!prefix) return;
        const kind = serviceCandidateKind(prefix);
        setDraft(value => ({ ...value, servicePrefix: prefix, flowKpi: value.flowKpi || kind || "" }));
        setNotice("");
      }}>
        <option value="">{options.length ? "Escolha um container" : "Nenhum container disponível"}</option>
        {options.map(option => {
          const kind = serviceCandidateKind(option.suggestedPrefix);
          const role = kind === "database" ? "Postgres" : "Redis";
          return <option key={option.suggestedPrefix} value={option.suggestedPrefix}>{draft.flowKpi ? option.suggestedPrefix : `${role} · ${option.suggestedPrefix}`}</option>;
        })}
      </select></Field>
      <Check label="Crítico, para notificar"><input type="checkbox" checked={draft.critical} onChange={event => setDraft(value => ({ ...value, critical: event.target.checked }))} /></Check>
      <Check label="Card na Disponibilidade"><input type="checkbox" checked={draft.dashboardEnabled} onChange={event => setDraft(value => ({ ...value, dashboardEnabled: event.target.checked }))} /></Check>
      {notice && <p role="alert" className="admin-error">{notice}</p>}
      <div className="admin-actions">
        <Button type="button" variant="primary" disabled={mutation.busy || services.length >= 20} onClick={() => void create()}><Plus aria-hidden="true" />Adicionar</Button>
      </div>
    </div>}
  </section>;
}
