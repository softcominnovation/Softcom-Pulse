"use client";
import { useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { z } from "zod";
import { api } from "@/lib/client/api";
import { storageConfigSchema, storagePreferencesSchema, storageWriteSchema, type StorageConfig, type StorageWrite } from "@/lib/config/storages";
import type { StorageView } from "@/lib/storage/contracts";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";
import { Check, Field, errorText, useAdminRead, useMutation } from "@/components/admin/shared";
import { ConfirmationDialog } from "@/components/confirmation-dialog";
import { metricValue } from "@/lib/dashboard/format";

export function StorageEditor({ item, onSaved, onCancel }: { item: StorageView; onSaved: () => void; onCancel: () => void }) {
  const saved = useAdminRead("/settings/storages", data => z.object({ data: storageConfigSchema.array() }).parse(data).data);
  if (saved.loading || saved.failed || !saved.data) return <div>{saved.failed ? <p role="alert">Não foi possível carregar a configuração.</p> : <p>Carregando configuração…</p>}<Button onClick={saved.refresh}>Recarregar</Button></div>;
  return <StorageForm item={item} config={saved.data.find(config => config.storageKey === item.storageKey) ?? null} onSaved={onSaved} onCancel={onCancel} reload={saved.refresh} />;
}
function StorageForm({ item, config, onSaved, onCancel, reload }: { item: StorageView; config: StorageConfig | null; onSaved: () => void; onCancel: () => void; reload: () => void }) {
  const defaults: StorageWrite = { ...storagePreferencesSchema.parse(config ? {
    displayName: config.displayName, description: config.description, dashboardEnabled: config.dashboardEnabled, critical: config.critical, displayOrder: config.displayOrder, filesystemKeys: config.filesystemKeys, independentVolumesConfirmed: config.independentVolumesConfirmed, networkInterfaceKey: config.networkInterfaceKey,
  } : {}), expectedRevision: config?.revision ?? 0 };
  const form = useForm<StorageWrite>({ defaultValues: defaults }), mutation = useMutation();
  const [error, setError] = useState("");
  const selected = useWatch({ control: form.control, name: "filesystemKeys" });
  const validInventory = !item.stale && item.resolution === "resolved";
  const unknownKeys = (selected ?? []).filter(key => !item.volumes.some(volume => volume.key === key));
  const custom = selected !== null;
  async function save(values: StorageWrite) {
    const parsed = storageWriteSchema.safeParse(values);
    if (!parsed.success) { for (const issue of parsed.error.issues) form.setError(issue.path[0] as keyof StorageWrite, { message: issue.message }); return; }
    setError("");
    try {
      await mutation.run(async signal => {
        await api.put(`/settings/storages/${encodeURIComponent(item.storageKey)}`, parsed.data, { signal });
        if (!signal.aborted) { window.dispatchEvent(new Event("pulse:preferences-changed")); toast({ message: "Configuração de Storage salva.", state: "success" }); onSaved(); }
      });
    } catch (cause) { setError(errorText(cause)); toast({ message: "Não foi possível salvar o Storage. Seu rascunho foi mantido.", state: "error" }); }
  }
  return <form className="admin-form" onSubmit={form.handleSubmit(save)}>
    <p className="admin-hint">Origem: {item.technicalName} · classificado no Zabbix. Esta configuração controla apenas os cards de Storage; um recurso genérico destacado pode aparecer também.</p>
    <div className="admin-fields">
      <Field label="Nome do Storage" error={form.formState.errors.displayName?.message} hint="Em branco, usa o nome retornado pelo Zabbix."><input maxLength={120} {...form.register("displayName")} /></Field>
      <Field label="Descrição" error={form.formState.errors.description?.message}><input maxLength={240} {...form.register("description")} /></Field>
      <Field label="Ordem" error={form.formState.errors.displayOrder?.message}><input type="number" min={0} max={100000} {...form.register("displayOrder", { valueAsNumber: true })} /></Field>
      <Field label="Interface de rede" hint="RX/TX desta interface aparecem no minicard e no painel de detalhes. O tráfego nunca é somado entre interfaces."><select disabled={!validInventory} {...form.register("networkInterfaceKey", { setValueAs: value => value || null })}><option value="">Não exibir tráfego</option>{item.interfaces.map(network => <option value={network.key} key={network.key}>{network.name}</option>)}{config?.networkInterfaceKey && !item.interfaces.some(network => network.key === config.networkInterfaceKey) && <option value={config.networkInterfaceKey}>Interface configurada ausente</option>}</select></Field>
    </div>
    <Check label="Destacar em Disponibilidade de Serviços"><input type="checkbox" {...form.register("dashboardEnabled")} /></Check>
    <Check label="Storage crítico"><input type="checkbox" {...form.register("critical")} /></Check>
    <Check label="Selecionar volumes manualmente"><input type="checkbox" checked={custom} disabled={!validInventory && !custom} onChange={event => { form.setValue("filesystemKeys", event.target.checked ? [] : null, { shouldDirty: true }); form.setValue("independentVolumesConfirmed", false); }} /></Check>
    <p className="admin-hint">Padrão: filesystem raiz (/), ou único filesystem descoberto. Vários volumes só podem ser somados se forem independentes, sem bind mounts ou capacidade compartilhada.</p>
    {custom && <fieldset className="storage-editor-volumes"><legend>Volumes monitorados</legend>{item.volumes.map(volume => <div key={volume.key}><Check label={volume.name}><input type="checkbox" disabled={!validInventory} checked={selected?.includes(volume.key) ?? false} onChange={event => { form.setValue("filesystemKeys", event.target.checked ? [...(selected ?? []), volume.key] : selected!.filter(key => key !== volume.key), { shouldDirty: true }); form.setValue("independentVolumesConfirmed", false); }} /></Check><small className="admin-hint">{volume.filesystemType ?? "Tipo não informado"} · {metricValue(volume.metrics.diskUsedBytes)} / {metricValue(volume.metrics.diskTotalBytes)}</small></div>)}{unknownKeys.map(key => <Check key={key} label="Volume configurado ausente"><input type="checkbox" checked onChange={() => form.setValue("filesystemKeys", selected!.filter(value => value !== key), { shouldDirty: true })} /></Check>)}</fieldset>}
    {(selected?.length ?? 0) > 1 && <Check label="Confirmo que os volumes selecionados são independentes e não duplicam a mesma capacidade"><input type="checkbox" {...form.register("independentVolumesConfirmed")} /></Check>}
    {(form.formState.errors.filesystemKeys || form.formState.errors.independentVolumesConfirmed) && <p role="alert" className="admin-error">{form.formState.errors.filesystemKeys?.message ?? form.formState.errors.independentVolumesConfirmed?.message}</p>}
    {!validInventory && <p className="admin-hint">Descoberta indisponível ou antiga. Nome e apresentação existentes podem ser editados; novas seleções precisam de descoberta atual.</p>}
    {error && <p role="alert" className="admin-error">{error}</p>}
    <div className="admin-actions"><Button type="button" disabled={mutation.busy} onClick={onCancel}>Cancelar</Button><ConfirmationDialog trigger={<Button type="button" disabled={mutation.busy}>Restaurar padrões</Button>} title="Restaurar padrões de Storage?" description="O rascunho voltará aos padrões. Salve para aplicar a alteração." confirmLabel="Restaurar padrões" onConfirm={() => { form.reset({ ...storagePreferencesSchema.parse({}), expectedRevision: defaults.expectedRevision }); setError(""); }} /><ConfirmationDialog trigger={<Button type="button" disabled={mutation.busy}>Recarregar versão salva</Button>} title="Descartar este rascunho?" description="A versão salva será carregada novamente." confirmLabel="Recarregar" onConfirm={reload} /><Button type="submit" variant="primary" disabled={mutation.busy}>{mutation.busy ? "Salvando…" : "Salvar Storage"}</Button></div>
  </form>;
}
