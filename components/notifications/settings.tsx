"use client";

import { useEffect, useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { ConfirmationDialog } from "@/components/confirmation-dialog";
import { api } from "@/lib/client/api";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";
import { Field, Check as CheckField, errorText } from "@/components/admin/shared";
import { defaultNotificationPolicy, notificationPolicySchema, notificationSettingsSchema, notificationEventTypes, notificationToastPositions, notificationOverrideSchema, type NotificationPolicy, type NotificationOverride, type NotificationToastPosition } from "@/lib/notifications/policy";

type Settings = { data: NotificationPolicy; targets: { ref: string; label: string; critical: boolean; enabled: boolean }[]; orphanRefs: string[] };
export function TargetNotificationSettings({ targetRef }: { targetRef?: string }) {
  const [open, setOpen] = useState(false), [visited, setVisited] = useState(false);
  return <div className="my-3" onKeyDown={event => { if (event.key === "Enter" && event.target instanceof HTMLInputElement) event.preventDefault(); }}>
    {targetRef ? <><Button type="button" size="sm" variant="outline" aria-expanded={open} onClick={() => { setVisited(true); setOpen(value => !value); }}>Notificações deste serviço</Button>{visited && <div hidden={!open}><NotificationSettings targetRef={targetRef} /></div>}</> : <p className="admin-muted">Salve o cadastro para configurar notificações específicas deste serviço.</p>}
  </div>;
}
const labels = { unavailable: "Indisponibilidade / falha de consulta", problem: "Problemas do Zabbix", attention: "Atenção / degradação", recovery: "Recuperação" };
const toastPositionLabels: Record<NotificationToastPosition, string> = { "bottom-end": "Canto inferior direito", "top-end": "Canto superior direito", "header-center": "Centro do header" };
function Check({ label, checked, onChange }: { label: string; checked: boolean; onChange: (checked: boolean) => void }) {
  return <CheckField label={label}><input type="checkbox" checked={checked} onChange={event => onChange(event.target.checked)} /></CheckField>;
}
export function NotificationSettings({ targetRef }: { targetRef?: string }) {
  const [loaded, setLoaded] = useState<Settings | null>(null);
  const form = useForm<NotificationPolicy>({ defaultValues: defaultNotificationPolicy() });
  const { reset } = form;
  const draft = useWatch({ control: form.control }) as NotificationPolicy;
  const setDraft = (next: NotificationPolicy) => {
    for (const key of Object.keys(next) as (keyof NotificationPolicy)[]) form.setValue(key, next[key], { shouldDirty: true });
  };
  const [selected, setSelected] = useState(targetRef ?? ""), [override, setOverride] = useState<NotificationOverride>(notificationOverrideSchema.parse({}));
  const overrideDirty = JSON.stringify(override) !== JSON.stringify(loaded?.data.overrides[selected] ?? notificationOverrideSchema.parse({}));
  const [error, setError] = useState(""), [busy, setBusy] = useState(false), [refresh, setRefresh] = useState(0);
  useEffect(() => {
    const abort = new AbortController();
    void api.get<Settings>("/settings/notifications", { signal: abort.signal }).then(response => {
      const data = notificationPolicySchema.parse(response.data.data);
      setLoaded({ ...response.data, data }); reset(data); setError("");
      setSelected(targetRef ?? ""); setOverride(data.overrides[targetRef ?? ""] ?? notificationOverrideSchema.parse({}));
    }).catch(() => { if (!abort.signal.aborted) setError("Não foi possível carregar as preferências de notificações."); });
    return () => abort.abort();
  }, [refresh, targetRef, reset]);
  async function save(global: boolean) {
    if (!loaded || busy) return; setBusy(true); setError("");
    try {
      if (global) {
        const values = { ...draft, overrides: { ...draft.overrides } } as Partial<NotificationPolicy>; delete values.schemaVersion; delete values.revision;
        for (const ref of loaded?.orphanRefs ?? []) delete values.overrides![ref];
        const settings = notificationSettingsSchema.parse(values);
        const saved = await api.put("/settings/notifications", { expectedRevision: loaded.data.revision, settings });
        const policy = notificationPolicySchema.parse(saved.data.data);
        reset(policy); setLoaded({ ...loaded, data: policy, orphanRefs: [] });
      } else {
        const saved = await api.put(`/settings/notifications/targets/${encodeURIComponent(selected)}`, { expectedRevision: loaded.data.revision, override: notificationOverrideSchema.parse(override) });
        const policy = notificationPolicySchema.parse(saved.data.data);
        // A target save advances its own revision without discarding the unsaved general policy.
        form.setValue("overrides", policy.overrides); form.setValue("revision", policy.revision);
        setLoaded({ ...loaded, data: policy });
      }
      toast({ message: "Preferências de notificações salvas.", state: "success" });
    } catch (failure) { setError(errorText(failure)); } finally { setBusy(false); }
  }
  if (!loaded) return <div className="admin-form"><p>{error || "Carregando preferências…"}</p>{error && <Button type="button" onClick={() => setRefresh(value => value + 1)}>Recarregar</Button>}</div>;
  return <section className="dashboard-panel"><div className="panel-heading"><h2>Notificações de serviços</h2></div><div className="admin-form space-y-4">
    <p className="admin-muted">Histórico e leitura são compartilhados. Volume e mute pertencem a este dispositivo.</p>
    <fieldset disabled={busy} className="space-y-4">
      {!targetRef && <>
        <Check label="Ativar notificações" checked={draft.enabled} onChange={enabled => setDraft({ ...draft, enabled })} />
        <div className="admin-fields"><Field label="Serviços incluídos"><select value={draft.targetScope} onChange={event => setDraft({ ...draft, targetScope: event.target.value as "critical" | "all" })}><option value="critical">Somente críticos</option><option value="all">Todos</option></select></Field><Field label="Severidade mínima do Zabbix"><select value={draft.minimumProblemSeverity} onChange={event => setDraft({ ...draft, minimumProblemSeverity: Number(event.target.value) })}>{["Não classificado", "Informação", "Atenção", "Média", "Alta", "Desastre"].map((text, index) => <option key={index} value={index}>{text}</option>)}</select></Field></div>
        {notificationEventTypes.map(key => <Check key={key} label={labels[key]} checked={draft.events[key]} onChange={checked => setDraft({ ...draft, events: { ...draft.events, [key]: checked } })} />)}
        <Check label="Permitir sons nas notificações" checked={draft.sounds.enabled} onChange={enabled => setDraft({ ...draft, sounds: { ...draft.sounds, enabled } })} />
        <Field label="Sons para"><select value={draft.sounds.targetScope} onChange={event => setDraft({ ...draft, sounds: { ...draft.sounds, targetScope: event.target.value as "critical" | "all" } })}><option value="critical">Somente críticos</option><option value="all">Todos os incluídos</option></select></Field>
        {notificationEventTypes.map(key => <Check key={key} label={`Som: ${labels[key]}`} checked={draft.sounds[key]} onChange={checked => setDraft({ ...draft, sounds: { ...draft.sounds, [key]: checked } })} />)}
        <Field label="Posição do aviso"><select value={draft.toastPosition} onChange={event => setDraft({ ...draft, toastPosition: event.target.value as NotificationToastPosition })}>{notificationToastPositions.map(value => <option key={value} value={value}>{toastPositionLabels[value]}</option>)}</select></Field>
        <div className="admin-fields"><Field label="Duração do aviso (segundos)"><input type="number" min={4} max={15} value={draft.toastLifetimeMs / 1000} onChange={event => setDraft({ ...draft, toastLifetimeMs: Number(event.target.value) * 1000 })} /></Field><Field label="Intervalo mínimo entre sons (segundos)"><input type="number" min={15} max={120} value={draft.soundCooldownMs / 1000} onChange={event => setDraft({ ...draft, soundCooldownMs: Number(event.target.value) * 1000 })} /></Field><Field label="Retenção de registros lidos e encerrados (dias)"><input type="number" min={7} max={365} value={draft.retentionDays} onChange={event => setDraft({ ...draft, retentionDays: Number(event.target.value) })} /></Field></div>
        {!!loaded?.orphanRefs.length && <p className="admin-notice">Existem exceções de serviços excluídos. Ao salvar a política, essas exceções serão removidas; o histórico será mantido.</p>}
        <Button type="button" variant="primary" onClick={() => void save(true)}>Salvar política geral</Button>
      </>}
      <Field label="Exceção por serviço" hint={overrideDirty ? "Salve ou descarte a exceção antes de trocar de serviço." : undefined}><select disabled={!!targetRef || overrideDirty} value={selected} onChange={event => { setSelected(event.target.value); setOverride(loaded.data.overrides[event.target.value] ?? notificationOverrideSchema.parse({})); }}><option value="">Selecione um serviço</option>{loaded.targets.map(target => <option key={target.ref} value={target.ref}>{target.label}{target.critical ? " · crítico" : ""}{!target.enabled ? " · monitor pausado" : ""}</option>)}</select></Field>
      {selected && <><div className="admin-fields"><Field label="Notificações deste serviço"><select value={override.mode} onChange={event => setOverride({ ...override, mode: event.target.value as NotificationOverride["mode"] })}><option value="inherit">Seguir política geral</option><option value="on">Incluir neste escopo</option><option value="off">Desativar</option></select></Field><Field label="Som deste serviço"><select value={override.sound} onChange={event => setOverride({ ...override, sound: event.target.value as NotificationOverride["sound"] })}><option value="inherit">Seguir política geral</option><option value="on">Incluir nos sons permitidos</option><option value="off">Silencioso</option></select></Field></div>
        {notificationEventTypes.map(key => <Field key={key} label={labels[key]}><select value={override.events?.[key] === undefined ? "inherit" : String(override.events[key])} onChange={event => { const events = { ...override.events }; if (event.target.value === "inherit") delete events[key]; else events[key] = event.target.value === "true"; setOverride({ ...override, events }); }}><option value="inherit">Seguir política geral</option><option value="true">Ativado</option><option value="false">Desativado</option></select></Field>)}
        <p className="admin-muted">A exceção não habilita monitor pausado nem ultrapassa mute, volume zero ou a desativação geral.</p><Button type="button" onClick={() => void save(false)}>Salvar notificações deste serviço</Button>{overrideDirty && <ConfirmationDialog trigger={<Button type="button" variant="ghost">Descartar exceção não salva</Button>} title="Descartar alterações da exceção?" description="A preferência salva deste serviço será restaurada. O rascunho geral será mantido." confirmLabel="Descartar exceção" onConfirm={() => setOverride(loaded.data.overrides[selected] ?? notificationOverrideSchema.parse({}))} />}</>}
    </fieldset>
    {error && <div role="alert" className="admin-error"><p>{error}</p><ConfirmationDialog trigger={<Button type="button">Recarregar valores salvos</Button>} title="Descartar os rascunhos de notificações?" description="A política e a exceção serão recarregadas do servidor. Alterações ainda não salvas serão descartadas." confirmLabel="Recarregar preferências" onConfirm={() => setRefresh(value => value + 1)} /></div>}
  </div></section>;
}
