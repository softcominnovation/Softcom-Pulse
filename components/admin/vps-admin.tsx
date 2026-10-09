"use client";

import { useEffect, useState, type ComponentProps } from "react";
import { PlaceLink } from "@/components/layout/place-link";
import { Eye, EyeOff, Pause, Pencil, Play, Power, Trash2 } from "lucide-react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";
import { isAxiosError } from "axios";
import { api } from "@/lib/client/api";
import { standaloneVpsCardSchema, standaloneVpsWriteSchema, type StandaloneVpsCard } from "@/lib/config/standalone-vps";
import { vpsAvailability, vpsMonitorLabel, vpsReasonColor, vpsStrip } from "@/lib/vps/labels";
import { useVpsSelectionStore } from "@/store/vps-selection.store";
import { ConfirmationDialog } from "@/components/confirmation-dialog";
import { probeLiveRefreshMs, ProbeStrip } from "@/components/dashboard/probe-strip";
import { Button } from "@/components/ui/button";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useAuthStore, useCanEdit } from "@/store/auth.store";
import { Check, Field, ReadError, errorText, useAdminRead, useMutation } from "./shared";

const parseList = (data: unknown) => z.object({ data: z.array(standaloneVpsCardSchema) }).parse(data).data;
type Draft = { name: string; provider: string; ip: string; domain: string; managerUrl: string; baseUrl: string; apiKey: string; timeoutSeconds: number; enabled: boolean; dashboardEnabled: boolean };
const emptyDraft: Draft = { name: "", provider: "", ip: "", domain: "", managerUrl: "", baseUrl: "", apiKey: "", timeoutSeconds: 5, enabled: true, dashboardEnabled: false };
function ApiKeyField({ show, onToggle, ...props }: ComponentProps<"input"> & { show: boolean; onToggle: () => void }) {
  return <div className="admin-secret">
    <input type={show ? "text" : "password"} autoComplete="new-password" maxLength={4096} {...props} />
    <button type="button" className="admin-secret-toggle" aria-label={show ? "Ocultar chave" : "Mostrar chave"} title={show ? "Ocultar chave" : "Mostrar chave"} aria-pressed={show} aria-controls={props.id} onClick={onToggle}>{show ? <EyeOff aria-hidden="true" /> : <Eye aria-hidden="true" />}</button>
  </div>;
}
function fromCard(item: StandaloneVpsCard): Draft {
  return { ...emptyDraft, name: item.name, provider: item.provider ?? "", ip: item.ip, domain: item.domain ?? "", managerUrl: item.managerUrl ?? "", baseUrl: item.baseUrl ?? "", apiKey: item.apiKey ?? "", timeoutSeconds: Math.round(item.timeoutMs / 1000), enabled: item.enabled, dashboardEnabled: item.dashboardEnabled };
}
export function VpsForm({ existing, onSaved, onCancel, onReload }: { existing?: StandaloneVpsCard; onSaved: () => void; onCancel: () => void; onReload: () => void }) {
  const form = useForm<Draft>({ defaultValues: existing ? fromCard(existing) : emptyDraft }), mutation = useMutation();
  const [error, setError] = useState(""), [conflict, setConflict] = useState(false), [showKey, setShowKey] = useState(false);
  async function setPaused(paused: boolean) {
    if (!existing) return;
    setError("");
    try {
      const updated = await mutation.run(signal => api.patch(`/monitoring/standalone-vps/${existing.id}`, { monitorPaused: paused, expectedRevision: existing.revision }, { signal }));
      if (!updated) return;
      toast.success(paused ? "Monitor pausado." : "Monitor retomado.");
      onReload();
    } catch (failure) { setError(errorText(failure)); }
  }
  const submit = form.handleSubmit(async draft => {
    setError(""); setConflict(false);
    const apiKey = draft.apiKey.trim();
    const parsed = standaloneVpsWriteSchema.safeParse({ name: draft.name, provider: draft.provider, ip: draft.ip, domain: draft.domain, managerUrl: draft.managerUrl, baseUrl: draft.baseUrl, enabled: draft.enabled, dashboardEnabled: draft.dashboardEnabled, timeoutMs: Math.round(draft.timeoutSeconds * 1000), ...(apiKey ? { apiKey } : {}) });
    if (!parsed.success) { setError("Revise os campos. O IP precisa ser IPv4 ou IPv6, o tempo limite fica entre 1 e 30 segundos, e a URL do monitor não leva usuário, senha, query ou fragmento."); return; }
    if (parsed.data.baseUrl && !apiKey && !existing?.monitorConfigured) { setError("Informe a URL base e a chave juntas, ou deixe as duas vazias."); return; }
    const body = { ...parsed.data, ...(existing ? { expectedRevision: existing.revision, ...(!parsed.data.baseUrl ? { apiKey: "" } : apiKey ? { apiKey } : {}) } : {}) };
    try {
      const result = await mutation.run(async signal => existing ? api.patch(`/monitoring/standalone-vps/${existing.id}`, body, { signal }) : api.post("/monitoring/standalone-vps", parsed.data, { signal }));
      if (result) { toast.success(existing ? "VPS atualizada." : "VPS cadastrada."); onSaved(); }
    } catch (failure) { setConflict(isAxiosError(failure) && failure.response?.data?.error?.code === "revision_conflict"); setError(errorText(failure)); }
  });
  return <form onSubmit={submit} className="admin-form"><p className="admin-muted">O intervalo entre consultas fica no ambiente, com padrão de 60 s. A chave guardada não é exibida.</p>
    <fieldset disabled={mutation.busy}><div className="admin-fields">
      <Field label="Nome"><input maxLength={120} {...form.register("name")} /></Field>
      <Field label="Provedor" hint="Opcional. Texto livre, como Hostinger, Oracle ou AWS."><input maxLength={120} {...form.register("provider")} /></Field>
      <Field label="Endereço IP"><input {...form.register("ip")} placeholder="10.1.1.8" /></Field>
      <Field label="Domínio"><input maxLength={255} {...form.register("domain")} /></Field>
      <Field label="URL do manager"><input maxLength={2048} {...form.register("managerUrl")} placeholder="https://painel.exemplo" /></Field>
      <Field label="URL base do monitor" hint="Usada quando a VPS tiver API de monitor."><input maxLength={2048} {...form.register("baseUrl")} placeholder="https://monitor.exemplo" /></Field>
      <Field label="Chave da API" hint={existing?.monitorConfigured ? "A chave salva volta neste campo. Em branco mantém a atual." : "Opcional. Entra junto com a URL base."}><ApiKeyField {...form.register("apiKey")} show={showKey} onToggle={() => setShowKey(value => !value)} /></Field>
      <Field label="Tempo limite" hint="Em segundos, de 1 a 30. O padrão é 5."><input type="number" min={1} max={30} step={1} {...form.register("timeoutSeconds", { valueAsNumber: true })} /></Field>
    </div><div className="admin-checks">
      <Check label="Ativa. A VPS inativa não é consultada."><input type="checkbox" {...form.register("enabled")} /></Check>
      <Check label="Destacar no dashboard"><input type="checkbox" {...form.register("dashboardEnabled")} /></Check>
    </div></fieldset>
    {error && <p role="alert" className="admin-error">{error}</p>}
    <div className="admin-actions">
      <Button type="submit" variant="primary" disabled={mutation.busy}>{mutation.busy ? "Salvando…" : "Salvar VPS"}</Button>
      <Button type="button" disabled={mutation.busy} onClick={onCancel}>Cancelar</Button>
      {existing?.monitorConfigured && (existing.monitorPaused
        ? <ConfirmationDialog trigger={<Button type="button" disabled={mutation.busy}><Play aria-hidden="true" />Retomar monitor</Button>} title="Retomar monitor?" description="A consulta volta na próxima rodada e a faixa recomeça vazia, da primeira posição. O histórico já guardado permanece. Nenhum recurso do Zabbix será alterado." confirmLabel="Retomar monitor" onConfirm={() => setPaused(false)} />
        : <ConfirmationDialog trigger={<Button type="button" disabled={mutation.busy}><Pause aria-hidden="true" />Pausar monitor</Button>} title="Pausar monitor?" description="A consulta para na próxima rodada e a faixa zera. O cadastro e o histórico permanecem. Nenhum recurso do Zabbix será alterado." confirmLabel="Pausar monitor" onConfirm={() => setPaused(true)} />)}
      {conflict && <Button type="button" onClick={onReload}>Recarregar versão salva</Button>}
    </div>
  </form>;
}
export function VpsAdmin() {
  const list = useAdminRead("/monitoring/standalone-vps", parseList), mutation = useMutation(), editor = useCanEdit();
  const authenticated = useAuthStore(state => state.status === "authenticated");
  const [query, setQuery] = useState(""), [draft, setDraft] = useState<StandaloneVpsCard | "new" | null>(null);
  const pendingId = useVpsSelectionStore(state => state.vpsId), consume = useVpsSelectionStore(state => state.consume);
  const items = list.data ?? [];
  const term = query.trim().toLocaleLowerCase("pt");
  const visible = items.filter(item => !term || [item.name, item.ip, item.domain ?? "", item.provider ?? ""].some(value => value.toLocaleLowerCase("pt").includes(term)));
  useEffect(() => { if (pendingId) consume(); }, [pendingId, consume]);
  useEffect(() => { if (authenticated) list.refresh(); }, [authenticated, list.refresh]);
  useEffect(() => {
    const tick = () => { if (!document.hidden) list.refresh(); };
    const timer = setInterval(tick, probeLiveRefreshMs);
    document.addEventListener("visibilitychange", tick);
    return () => { clearInterval(timer); document.removeEventListener("visibilitychange", tick); };
  }, [list.refresh]);
  async function reloadSaved() {
    const response = await api.get("/monitoring/standalone-vps");
    const next = parseList(response.data);
    list.refresh();
    if (draft && draft !== "new") setDraft(next.find(item => item.id === draft.id) ?? null);
  }
  async function setEnabled(item: StandaloneVpsCard, enabled: boolean) {
    const updated = await mutation.run(signal => api.patch(`/monitoring/standalone-vps/${item.id}`, { enabled, expectedRevision: item.revision }, { signal }));
    if (!updated) throw new Error("vps_state_failed");
    toast.success(enabled ? "VPS ativada." : "VPS inativada.");
    list.refresh();
  }
  async function remove(item: StandaloneVpsCard) {
    const removed = await mutation.run(signal => api.delete(`/monitoring/standalone-vps/${item.id}`, { signal }));
    if (!removed) return;
    toast.success("VPS removida.");
    if (draft && draft !== "new" && draft.id === item.id) setDraft(null);
    list.refresh();
  }
  return <div className="admin-page">
    <header className="admin-heading app-monitor-heading"><div><h1>VPS</h1><p>Cadastro das VPS avulsas. O monitor, quando existe, é consultado pelo Pulse. O navegador não chama essa URL.</p></div>{editor && <Button type="button" variant="primary" onClick={() => setDraft("new")}>Nova VPS</Button>}</header>
    <Field label="Buscar"><input value={query} onChange={event => setQuery(event.target.value)} placeholder="Nome, IP, domínio ou provedor" /></Field>
    {list.failed && <ReadError refresh={list.refresh}>Não foi possível ler as VPS cadastradas.</ReadError>}
    {list.loading && !list.data && <p className="panel-empty">Carregando VPS…</p>}
    {list.data && !items.length && <p className="panel-empty">{editor ? "Ainda não há VPS. Use o botão Nova VPS para cadastrar a primeira." : "Ainda não há VPS."}</p>}
    {list.data && !!items.length && !visible.length && <p className="panel-empty">Nenhuma VPS corresponde à busca.</p>}
    {!!visible.length && <ul className="vps-grid">{visible.map(item => {
      const availability = vpsAvailability(item.enabled);
      const monitor = vpsMonitorLabel(item.monitorState);
      return <li key={item.id}><article className={`dashboard-panel vps-card ${item.enabled ? "" : "is-inactive"}`}>
        <div className="vps-card-head"><PlaceLink href={`/admin/vps/${item.id}`}><strong>{item.name}</strong></PlaceLink><span className={`app-presence tone-${availability.tone}`}>{availability.label}</span></div>
        {item.provider && <p className="app-monitor-meta">{item.provider}</p>}
        <p>{item.ip}</p>
        {item.domain && <p className="app-monitor-meta">{item.domain}</p>}
        {authenticated && item.managerUrl && <a href={item.managerUrl} target="_blank" rel="noreferrer">Abrir manager</a>}
        {monitor && monitor.label !== availability.label && <p className={`vps-monitor tone-${monitor.tone}`}>{monitor.label}</p>}
        <ProbeStrip reasons={vpsStrip(item.enabled, item.monitorConfigured, item.strip, item.monitorPaused)} colorFor={vpsReasonColor} />
        <div className="vps-card-toolbar">
          <PlaceLink className="vps-details-link" href={`/admin/vps/${item.id}`}>Detalhes</PlaceLink>
          {editor && <div className="admin-actions app-monitor-actions">
          <Button type="button" size="icon" aria-label={`Editar ${item.name}`} title="Editar" onClick={() => setDraft(item)}><Pencil aria-hidden="true" /></Button>
          {item.enabled
            ? <ConfirmationDialog trigger={<Button type="button" size="icon" aria-label={`Inativar ${item.name}`} title="Inativar"><Power aria-hidden="true" /></Button>} title="Inativar VPS?" description="A coleta desta VPS para na próxima rodada. O cadastro e os serviços permanecem. Nenhum recurso do Zabbix será alterado." confirmLabel="Inativar VPS" onConfirm={() => setEnabled(item, false)} />
            : <ConfirmationDialog trigger={<Button type="button" size="icon" aria-label={`Ativar ${item.name}`} title="Ativar"><Power aria-hidden="true" /></Button>} title="Ativar VPS?" description="A VPS volta a ficar disponível. Se houver monitor cadastrado, a coleta retoma na próxima rodada. Nenhum recurso do Zabbix será alterado." confirmLabel="Ativar VPS" onConfirm={() => setEnabled(item, true)} />}
          <ConfirmationDialog trigger={<Button type="button" size="icon" variant="destructive" aria-label={`Remover ${item.name}`} title="Remover"><Trash2 aria-hidden="true" /></Button>} title="Remover VPS?" description="A VPS, os serviços e as amostras serão apagados. Nenhum recurso do Zabbix será alterado." confirmLabel="Remover VPS" destructive onConfirm={() => remove(item)} />
          </div>}
        </div>
      </article></li>;
    })}</ul>}
    <Dialog open={draft !== null} onOpenChange={open => { if (!open) setDraft(null); }}><DialogContent className="vps-dialog"><DialogHeader><DialogTitle>{draft && draft !== "new" ? "Editar VPS" : "Nova VPS"}</DialogTitle><DialogDescription>O cadastro fica no Pulse. A URL do manager, quando aberta, é só um link.</DialogDescription></DialogHeader><DialogBody>
      {editor && draft && <VpsForm key={draft === "new" ? "new" : `${draft.id}:${draft.revision}`} existing={draft === "new" ? undefined : draft} onSaved={() => { setDraft(null); list.refresh(); }} onCancel={() => setDraft(null)} onReload={() => { void reloadSaved(); }} />}
    </DialogBody></DialogContent></Dialog>
  </div>;
}
