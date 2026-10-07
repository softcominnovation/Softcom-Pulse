"use client";

import { useEffect, useState } from "react";
import { Pause, Pencil, Play, Trash2 } from "lucide-react";
import { useForm, useWatch } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";
import { isAxiosError } from "axios";
import { api } from "@/lib/client/api";
import { externalServicePublicSchema, externalServiceWriteSchema, serviceIssues, type ExternalServiceInput, type ExternalServicePublic } from "@/lib/config/external-services";
import { ConfirmationDialog } from "@/components/confirmation-dialog";
import { ProbeHistoryPanel } from "@/components/dashboard/probe-details";
import { probeLiveRefreshMs, ProbeStrip } from "@/components/dashboard/probe-strip";
import { Button } from "@/components/ui/button";
import { formatUptime, probePresence, probeStatus } from "@/lib/probe/status";
import { useProbeSelectionStore } from "@/store/probe-selection.store";
import { Check, Field, ReadError, errorText, useAdminRead, useMutation } from "./shared";

const parseServices = (data: unknown) => z.object({ data: z.array(externalServicePublicSchema) }).parse(data).data;
type Draft = { displayName: string; description: string; serviceType: string; enabled: boolean; dashboardEnabled: boolean; critical: boolean; displayOrder: number; method: "GET" | "HEAD" | "POST"; url: string; successMode: "http_status" | "json_match"; expectedStatuses: string; jsonPointer: string; expectedValue: string; bodyTemplate: string; authMode: "none" | "header"; headerName: string; timeoutSeconds: number; secret: string; removeSecret: boolean };
const emptyDraft: Draft = { displayName: "", description: "", serviceType: "", enabled: true, dashboardEnabled: false, critical: false, displayOrder: 0, method: "GET", url: "", successMode: "http_status", expectedStatuses: "200", jsonPointer: "", expectedValue: "", bodyTemplate: "", authMode: "none", headerName: "", timeoutSeconds: 5, secret: "", removeSecret: false };
function literalText(value: string | number | boolean | null) { return value === null ? "" : String(value); }
function fromService(service: ExternalServicePublic): Draft {
  return { ...emptyDraft, displayName: service.displayName, description: service.description ?? "", serviceType: service.serviceType ?? "", enabled: service.enabled, dashboardEnabled: service.dashboardEnabled, critical: service.critical, displayOrder: service.displayOrder, method: service.method, url: service.url, successMode: service.successMode, expectedStatuses: service.expectedStatuses.join(", "), jsonPointer: service.jsonPointer ?? "", expectedValue: literalText(service.expectedValue), bodyTemplate: service.bodyTemplate ?? "", authMode: service.authMode, headerName: service.headerName ?? "", timeoutSeconds: Math.round(service.timeoutMs / 1000) };
}
function toInput(draft: Draft): ExternalServiceInput {
  const text = draft.expectedValue.trim();
  const expectedValue = text === "true" ? true : text === "false" ? false : /^-?(?:0|[1-9]\d*)(?:\.\d+)?$/.test(text) ? Number(text) : text;
  const secret = draft.secret.trim();
  return { displayName: draft.displayName, description: draft.description.trim() || null, serviceType: draft.serviceType.trim() || null, enabled: draft.enabled, dashboardEnabled: draft.dashboardEnabled, critical: draft.critical, displayOrder: draft.displayOrder, method: draft.method, url: draft.url.trim(), successMode: draft.successMode, expectedStatuses: draft.expectedStatuses.split(/[,\s]+/).filter(Boolean).map(Number), jsonPointer: draft.successMode === "json_match" ? draft.jsonPointer.trim() || null : null, expectedValue: draft.successMode === "json_match" && text ? expectedValue : null, bodyTemplate: draft.method === "POST" ? draft.bodyTemplate.trim() || null : null, authMode: draft.authMode, headerName: draft.authMode === "header" ? draft.headerName.trim() || null : null, timeoutMs: Math.round(draft.timeoutSeconds * 1000), ...(secret ? { secret } : draft.removeSecret ? { secret: null } : {}) };
}
function ApplicationForm({ existing, onSaved, onCancel, onReload }: { existing?: ExternalServicePublic; onSaved: (id: string) => void; onCancel: () => void; onReload: () => void }) {
  const form = useForm<Draft>({ defaultValues: existing ? fromService(existing) : emptyDraft }), value = useWatch({ control: form.control }) as Draft, mutation = useMutation();
  const [error, setError] = useState(""), [conflict, setConflict] = useState(false);
  const submit = form.handleSubmit(async draft => {
    setError(""); setConflict(false);
    const input = toInput(draft);
    const parsed = externalServiceWriteSchema.safeParse(input);
    if (!parsed.success || serviceIssues(parsed.success ? parsed.data : input, Boolean(existing?.secretConfigured) && !draft.removeSecret && !draft.secret.trim()).length) { setError("Revise os campos. A URL precisa ser HTTPS, o tempo limite fica entre 1 e 30 segundos, o JSON só vale com ponteiro e valor esperado, e o segredo só é pedido quando o cabeçalho ou o corpo usam."); return; }
    try {
      const result = await mutation.run(async signal => existing ? api.patch<{ data: { id: string } }>(`/monitoring/external-services/${existing.id}`, { ...parsed.data, expectedRevision: existing.revision }, { signal }) : api.post<{ data: { id: string } }>("/monitoring/external-services", parsed.data, { signal }));
      if (result) { toast.success(existing ? "Aplicação atualizada." : "Aplicação cadastrada."); onSaved(result.data.data.id); }
    } catch (failure) { setConflict(isAxiosError(failure) && failure.response?.data?.error?.code === "revision_conflict"); setError(errorText(failure)); }
  });
  return <section className="dashboard-panel admin-editor" aria-label={existing ? "Editar aplicação" : "Nova aplicação"}><div className="panel-heading"><h2>{existing ? "Editar aplicação" : "Nova aplicação"}</h2></div>
    <form onSubmit={submit} className="admin-form"><p className="admin-muted">O intervalo entre consultas fica no ambiente, com padrão de 60 s. O tempo limite é desta aplicação. O segredo guardado não é exibido.</p>
      <fieldset disabled={mutation.busy}><div className="admin-fields">
        <Field label="Nome"><input maxLength={120} {...form.register("displayName")} /></Field>
        <Field label="Descrição" hint="Se ficar vazia, o card usa o tipo do serviço."><input maxLength={240} {...form.register("description")} /></Field>
        <Field label="Tipo do serviço"><input maxLength={40} {...form.register("serviceType")} placeholder="Ex.: API, Front, Worker" /></Field>
        <Field label="Ordem de exibição"><input type="number" {...form.register("displayOrder", { valueAsNumber: true })} /></Field>
        <Field label="Método"><select {...form.register("method")}><option>GET</option><option>HEAD</option><option>POST</option></select></Field>
        <Field label="URL" hint="Somente HTTPS, sem usuário, senha, query ou fragmento."><input maxLength={2048} {...form.register("url")} placeholder="https://exemplo.softcom.cloud/health" /></Field>
        <Field label="Tempo limite" hint="Em segundos, de 1 a 30. O padrão é 5. A resposta dentro desse tempo continua no ar: até a metade fica Disponível e acima da metade fica Lenta. Para uma API de 8 a 15 s, use 20."><input type="number" min={1} max={30} step={1} {...form.register("timeoutSeconds", { valueAsNumber: true })} /></Field>
        <Field label="Critério de sucesso"><select {...form.register("successMode")}><option value="http_status">Status HTTP</option><option value="json_match">Valor JSON</option></select></Field>
        <Field label="Status esperados" hint="De um a quatro códigos entre 200 e 299."><input {...form.register("expectedStatuses")} placeholder="200, 204" /></Field>
        {value.successMode === "json_match" && <><Field label="Ponteiro JSON" hint="Começa com /, no formato RFC 6901."><input maxLength={80} {...form.register("jsonPointer")} placeholder="/status" /></Field><Field label="Valor esperado" hint="true, false e números viram JSON. O restante é texto."><input maxLength={80} {...form.register("expectedValue")} /></Field></>}
        {value.method === "POST" && <Field label="Corpo" hint="JSON de até 2 KB. Use {{secret}} onde o segredo entra."><textarea maxLength={2048} {...form.register("bodyTemplate")} /></Field>}
        <Field label="Autenticação"><select {...form.register("authMode")}><option value="none">Nenhuma</option><option value="header">Cabeçalho</option></select></Field>
        {value.authMode === "header" && <Field label="Nome do cabeçalho" hint="Authorization, X-Api-Key ou um nome simples."><input maxLength={40} {...form.register("headerName")} placeholder="Authorization" /></Field>}
        <Field label="Segredo" hint={existing?.secretConfigured ? "Vazio mantém o segredo já guardado." : "Opcional, salvo quando o cabeçalho ou o corpo precisam dele."}><input type="password" autoComplete="new-password" maxLength={4096} {...form.register("secret")} /></Field>
      </div><div className="admin-checks">
        <Check label="Cadastro habilitado"><input type="checkbox" {...form.register("enabled")} /></Check>
        <Check label="Destacar no dashboard"><input type="checkbox" {...form.register("dashboardEnabled")} /></Check>
        <Check label="Aplicação crítica"><input type="checkbox" {...form.register("critical")} /></Check>
        {existing?.secretConfigured && <Check label="Remover segredo guardado"><input type="checkbox" {...form.register("removeSecret")} /></Check>}
      </div></fieldset>
      {error && <p role="alert" className="admin-error">{error}</p>}
      <div className="admin-actions"><Button type="submit" variant="primary" disabled={mutation.busy}>{mutation.busy ? "Salvando…" : "Salvar aplicação"}</Button><Button type="button" disabled={mutation.busy} onClick={onCancel}>Cancelar</Button>{conflict && <Button type="button" onClick={onReload}>Recarregar versão salva</Button>}</div>
    </form></section>;
}
export function ApplicationsAdmin() {
  const services = useAdminRead("/monitoring/external-services", parseServices), mutation = useMutation();
  const [draft, setDraft] = useState<ExternalServicePublic | "new" | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const pendingServiceId = useProbeSelectionStore(state => state.serviceId);
  const consumeSelection = useProbeSelectionStore(state => state.consume);
  const items = services.data ?? [];
  const selected = items.find(item => item.id === selectedId) ?? items[0] ?? null;
  useEffect(() => {
    if (!pendingServiceId) return;
    setSelectedId(pendingServiceId);
    setDraft(null);
    consumeSelection();
  }, [pendingServiceId, consumeSelection]);
  useEffect(() => {
    const tick = () => { if (!document.hidden) services.refresh(); };
    const timer = setInterval(tick, probeLiveRefreshMs);
    document.addEventListener("visibilitychange", tick);
    return () => { clearInterval(timer); document.removeEventListener("visibilitychange", tick); };
  }, [services.refresh]);
  const presence = selected && !selected.enabled ? { label: "Pausado", tone: "unknown" as const } : probePresence(selected?.uptime?.reason ?? null);
  const status = probeStatus(selected?.uptime?.reason ?? null);
  async function reloadSaved() {
    const response = await api.get("/monitoring/external-services");
    const next = parseServices(response.data);
    services.refresh();
    if (draft && draft !== "new") setDraft(next.find(item => item.id === draft.id) ?? null);
  }
  async function setRunning(enabled: boolean) {
    if (!selected) return;
    const updated = await mutation.run(signal => api.patch(`/monitoring/external-services/${selected.id}`, { enabled, expectedRevision: selected.revision }, { signal }));
    if (!updated) throw new Error("pause_failed");
    toast.success(enabled ? "Aplicação retomada." : "Aplicação pausada.");
    services.refresh();
  }
  async function removeSelected() {
    if (!selected) return;
    const removed = await mutation.run(signal => api.delete(`/monitoring/external-services/${selected.id}`, { signal }));
    if (!removed) return;
    toast.success("Aplicação removida.");
    if (draft && draft !== "new" && draft.id === selected.id) setDraft(null);
    setSelectedId(null);
    services.refresh();
  }
  return <div className="admin-page">
    <header className="admin-heading app-monitor-heading"><div><h1>Aplicações</h1><p>Cadastro das consultas HTTPS. O dashboard e o bloco de uptime leem o último resultado publicado, sem chamar essas URLs no navegador.</p></div><Button type="button" variant="primary" onClick={() => setDraft("new")}>Nova aplicação</Button></header>
    {services.failed && <ReadError refresh={services.refresh}>Não foi possível ler as aplicações cadastradas.</ReadError>}
    {services.loading && !services.data && <p className="panel-empty">Carregando aplicações…</p>}
    {services.data && <div className="app-monitor">
      <ul className="app-monitor-list">{items.map(service => {
        const itemStatus = probeStatus(service.uptime?.reason ?? null);
        const uptime = formatUptime(service.uptime?.uptime24h ?? null);
        const running = service.enabled ? itemStatus.label : "Pausada";
        return <li key={service.id}><button type="button" className="app-monitor-item" aria-current={selected?.id === service.id ? "true" : undefined} aria-label={`${service.displayName}, ${running}, disponibilidade ${uptime}`} onClick={() => { setSelectedId(service.id); setDraft(null); }}>
          <span className="app-monitor-item-head"><strong>{service.displayName}</strong><span>{uptime}</span></span>
          <span className="app-monitor-meta">{service.method} · {service.serviceType || "Sem tipo"} · {running}</span>
          <ProbeStrip reasons={service.enabled ? service.uptime?.strip ?? [] : []} />
        </button></li>;
      })}{!items.length && <li className="app-monitor-empty">Nenhuma aplicação cadastrada.</li>}</ul>
      <div className="app-monitor-main">
        {draft && <ApplicationForm key={draft === "new" ? "new" : `${draft.id}:${draft.revision}`} existing={draft === "new" ? undefined : draft} onSaved={id => { setSelectedId(id); setDraft(null); services.refresh(); }} onCancel={() => setDraft(null)} onReload={() => { void reloadSaved(); }} />}
        {!draft && selected && <section className="dashboard-panel app-monitor-detail" aria-label={selected.displayName}>
          <div className="panel-heading"><div><span className={`app-presence tone-${presence.tone}`}>{presence.label}</span><h2>{selected.displayName}</h2><p className="app-monitor-meta">{selected.method} {selected.url}</p><p className="app-monitor-meta">{selected.enabled ? status.label : "Pausada"} · {selected.serviceType || "Sem tipo"} · {selected.dashboardEnabled ? "Em destaque" : "Sem destaque"} · Segredo {selected.secretConfigured ? "configurado" : "não configurado"}</p></div>
            <div className="admin-actions app-monitor-actions">
              <Button type="button" size="icon" aria-label="Editar" title="Editar" onClick={() => setDraft(selected)}><Pencil aria-hidden="true" /></Button>
              {selected.enabled
                ? <ConfirmationDialog trigger={<Button type="button" size="icon" aria-label="Pausar" title="Pausar"><Pause aria-hidden="true" /></Button>} title="Pausar aplicação?" description="A sonda deixa de consultar esta URL na próxima rodada. O cadastro e o histórico permanecem, e o card deixa de receber resultado novo enquanto estiver pausado. Nenhum recurso do Zabbix será alterado." confirmLabel="Pausar aplicação" onConfirm={() => setRunning(false)} />
                : <ConfirmationDialog trigger={<Button type="button" size="icon" aria-label="Retomar" title="Retomar"><Play aria-hidden="true" /></Button>} title="Retomar aplicação?" description="A sonda volta a consultar esta URL na próxima rodada. O histórico já guardado permanece. Nenhum recurso do Zabbix será alterado." confirmLabel="Retomar aplicação" onConfirm={() => setRunning(true)} />}
              <ConfirmationDialog trigger={<Button type="button" size="icon" variant="destructive" aria-label="Remover" title="Remover"><Trash2 aria-hidden="true" /></Button>} title="Remover aplicação?" description="O cadastro e o histórico da aplicação serão apagados. Nenhum recurso do Zabbix será alterado." confirmLabel="Remover aplicação" destructive onConfirm={removeSelected} />
            </div>
          </div>
          <div className="app-monitor-body"><ProbeHistoryPanel serviceId={selected.id} paused={!selected.enabled} progressStartedAt={selected.progressStartedAt} /></div>
        </section>}
        {!draft && !selected && <p className="panel-empty">Nenhuma aplicação cadastrada.</p>}
      </div>
    </div>}
  </div>;
}
