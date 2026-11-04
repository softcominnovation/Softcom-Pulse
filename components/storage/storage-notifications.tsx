"use client";

import { useEffect, useRef, useState, type FormEvent, type RefObject } from "react";
import { z } from "zod";
import { api } from "@/lib/client/api";
import { storageConfigSchema, storageWriteSchema } from "@/lib/config/storages";
import type { StorageView } from "@/lib/storage/contracts";
import { storageCapacity } from "@/lib/storage/presentation";
import { metricValue } from "@/lib/dashboard/format";
import { Check, Field, errorText, useAdminRead, useMutation } from "@/components/admin/shared";
import { NotificationSettings } from "@/components/notifications/settings";
import { ConfirmationDialog } from "@/components/confirmation-dialog";
import { Button } from "@/components/ui/button";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "@/components/ui/toast";

export function StorageNotificationSettings({ item, onSaved }: { item: StorageView; onSaved: () => void }) {
  const [open, setOpen] = useState(false), [visited, setVisited] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  return <>
    <Button ref={trigger} type="button" size="sm" variant="outline" data-sound="open" aria-haspopup="dialog" aria-expanded={open} onClick={() => { setVisited(true); setOpen(true); }}>Notificações deste serviço</Button>
    {visited && <StorageNotificationDialog item={item} open={open} setOpen={setOpen} trigger={trigger} onSaved={onSaved} />}
  </>;
}

function StorageNotificationDialog({ item, open, setOpen, trigger, onSaved }: { item: StorageView; open: boolean; setOpen: (open: boolean) => void; trigger: RefObject<HTMLButtonElement | null>; onSaved: () => void }) {
  const saved = useAdminRead("/settings/storages", data => z.object({ data: storageConfigSchema.array() }).parse(data).data);
  const { refresh } = saved;
  const config = saved.data?.find(value => value.storageKey === item.storageKey);
  const mutation = useMutation();
  const [draft, setDraft] = useState<string | null>();
  const [error, setError] = useState("");
  const [tab, setTab] = useState("alerts");
  const seenRevision = useRef(item.revision);
  const warning = draft === undefined ? config?.diskWarningPercent?.toString() ?? null : draft;
  const filesystemKeys = config?.filesystemKeys ?? (warning !== null ? item.capacity.filesystemKeys : null);
  const capacity = storageCapacity(item.volumes, { filesystemKeys, independentVolumesConfirmed: config?.independentVolumesConfirmed ?? false });
  const validInventory = !item.stale && item.resolution === "resolved";
  useEffect(() => {
    if (item.revision <= seenRevision.current) return;
    seenRevision.current = item.revision;
    if (draft === undefined) refresh();
  }, [item.revision, draft, refresh]);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!config || saved.loading || mutation.busy) return;
    const parsed = storageWriteSchema.safeParse({
      displayName: config.displayName, description: config.description, dashboardEnabled: config.dashboardEnabled, critical: config.critical,
      displayOrder: config.displayOrder, networkInterfaceKey: config.networkInterfaceKey, filesystemKeys, cardMetrics: config.cardMetrics,
      independentVolumesConfirmed: config.independentVolumesConfirmed, diskWarningPercent: warning === null ? null : Number(warning), expectedRevision: config.revision,
    });
    if (!parsed.success) { setError(parsed.error.issues[0]?.message ?? "Confira o limite e os volumes monitorados."); return; }
    setError("");
    try {
      await mutation.run(async signal => {
        await api.put(`/settings/storages/${encodeURIComponent(item.storageKey)}`, parsed.data, { signal });
        if (!signal.aborted) {
          setDraft(undefined); saved.refresh(); onSaved();
          window.dispatchEvent(new Event("pulse:preferences-changed"));
          toast({ message: "Alerta de disco salvo.", state: "success" });
        }
      });
    } catch (cause) { setError(errorText(cause)); }
  }

  return <NotificationSettings targetRef={`storage:${item.configId}`} render={policy => <Dialog open={open} onOpenChange={value => { if (!mutation.busy) setOpen(value); }}>
    <DialogContent className="w-[44rem] max-w-[calc(100vw-2rem)] max-h-[calc(100dvh-2rem)]" onCloseAutoFocus={event => { event.preventDefault(); trigger.current?.focus(); }}>
      <DialogHeader><DialogTitle>Notificações do serviço</DialogTitle><DialogDescription>{item.displayName} · Alertas de disco, avisos e sons.</DialogDescription></DialogHeader>
      <Tabs className="min-h-0 flex-1 gap-0" value={tab} onValueChange={value => { if (typeof value === "string") setTab(value); }}>
        <TabsList className="mx-6 mt-4 shrink-0" aria-label="Configurações de notificações do Storage"><TabsTrigger value="alerts">Alerta de disco</TabsTrigger><TabsTrigger value="delivery">Entrega e sons</TabsTrigger></TabsList>
        <DialogBody>
        <TabsContent value="alerts"><section aria-label="Alerta de disco">
          {!config ? <div className="admin-form"><p role={saved.failed ? "alert" : undefined}>{saved.failed ? "Não foi possível carregar o alerta de disco." : saved.loading ? "Carregando alerta de disco…" : "Salve a configuração do Storage antes de configurar o alerta."}</p><Button type="button" onClick={saved.refresh}>Recarregar alerta</Button></div> : <form className="admin-form" onSubmit={save}>
            <fieldset disabled={mutation.busy || saved.loading}>
              <Check label="Alertar ocupação do disco"><input type="checkbox" checked={warning !== null} disabled={warning === null && !validInventory} onChange={event => { setDraft(event.target.checked ? "70" : null); setError(""); }} /></Check>
              <Field label="Limite de disco (%)" hint="Percentual ocupado nos mesmos volumes do card. 70% significa ocupado, não livre."><input type="number" min={1} max={100} step={1} required disabled={warning === null} value={warning ?? ""} onChange={event => setDraft(event.target.value)} /></Field>
              <p className="admin-hint">Capacidade selecionada: {metricValue(capacity.usagePercent)} · {metricValue(capacity.usedBytes)} / {metricValue(capacity.totalBytes)}.</p>
              <p className="admin-hint">Volumes monitorados: {capacity.filesystemKeys.map(key => item.volumes.find(volume => volume.key === key)?.name ?? "Volume ausente").join(", ") || "Nenhum volume disponível"}. A seleção é feita em Editar configuração.</p>
              <p className="admin-hint">Confirma após duas amostras novas e pelo menos 30s. Recupera com margem abaixo do limite. Não altera alertas da VM em ASGARD.</p>
              {!validInventory && <p className="admin-hint">Descoberta indisponível ou antiga. É possível ajustar ou desativar um alerta existente; a ativação exige leitura atual.</p>}
              {error && <p role="alert" className="admin-error">{error}</p>}
              <div className="admin-actions"><Button type="submit" variant="primary">{mutation.busy ? "Salvando…" : "Salvar alerta de disco"}</Button><ConfirmationDialog trigger={<Button type="button" variant="outline">Recarregar alerta salvo</Button>} title="Descartar o rascunho do alerta?" description="O limite salvo será recarregado. As preferências de avisos e sons não serão alteradas." confirmLabel="Recarregar alerta" onConfirm={() => { setDraft(undefined); setError(""); saved.refresh(); }} /></div>
            </fieldset>
          </form>}
        </section></TabsContent>
        <TabsContent value="delivery"><p className="admin-hint mb-3">Estas preferências têm salvamento próprio. O limite fica na aba Alerta de disco.</p>{policy}</TabsContent>
        </DialogBody>
      </Tabs>
    </DialogContent>
  </Dialog>} />;
}
