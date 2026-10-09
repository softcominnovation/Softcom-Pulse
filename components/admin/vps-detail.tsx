"use client";

import { useEffect, useState, type ReactNode } from "react";
import { PlaceLink, usePlaceHref } from "@/components/layout/place-link";
import { usePathname, useRouter } from "next/navigation";
import { Activity, Cpu, Eye, HardDrive, MemoryStick, Pause, Pencil, Play, Power, Trash2 } from "lucide-react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";
import { api } from "@/lib/client/api";
import { standaloneVpsDetailSchema, vpsStackWriteSchema, type StandaloneVpsDetail, type VpsStackRecord } from "@/lib/config/standalone-vps";
import { timestamp } from "@/lib/dashboard/format";
import { isPublicPath } from "@/lib/public/paths";
import { vpsAvailability, vpsMonitorLabel, vpsReasonColor, vpsStrip } from "@/lib/vps/labels";
import { ConfirmationDialog } from "@/components/confirmation-dialog";
import { probeLiveRefreshMs, ProbeStrip } from "@/components/dashboard/probe-strip";
import { Button } from "@/components/ui/button";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useAuthStore, useCanEdit } from "@/store/auth.store";
import { VpsForm } from "./vps-admin";
import { Field, ReadError, errorText, useAdminRead, useMutation } from "./shared";

const parseDetail = (data: unknown) => z.object({ data: standaloneVpsDetailSchema }).parse(data).data;
function percent(value: number | null) { return value === null ? null : `${value.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`; }
function UsageMeter({ series, value, fill }: { series: "cpu" | "memory" | "disk"; value: number | null; fill: boolean }) {
  const width = value === null ? 0 : Math.max(0, Math.min(100, value));
  return <svg className={`metric-meter series-${series}`} viewBox="0 0 100 4" preserveAspectRatio="none" aria-hidden="true"><rect width="100" height="4" rx="2" className="meter-track" />{fill && value !== null && <rect width={width} height="4" rx="2" className="meter-value" />}</svg>;
}
function MetricRow({ series, icon, label, hint, value, fill }: { series: "cpu" | "memory" | "disk"; icon: ReactNode; label: string; hint: string; value: number | null; fill: boolean }) {
  return <div className={`vps-metric-row series-${series}`}>{icon}<div><header><span>{label}</span>{hint && <small>{hint}</small>}<strong>{fill ? percent(value) ?? "—" : "—"}</strong></header><UsageMeter series={series} value={value} fill={fill && value !== null} /></div></div>;
}
function StackForm({ vpsId, existing, onSaved, onCancel }: { vpsId: string; existing?: VpsStackRecord; onSaved: () => void; onCancel: () => void }) {
  const form = useForm({ defaultValues: { name: existing?.name ?? "", link: existing?.link ?? "", notes: existing?.notes ?? "" } }), mutation = useMutation();
  const [error, setError] = useState("");
  const submit = form.handleSubmit(async draft => {
    setError("");
    const parsed = vpsStackWriteSchema.safeParse(draft);
    if (!parsed.success) { setError("Revise o nome e o link do serviço."); return; }
    try {
      const result = await mutation.run(signal => existing ? api.patch(`/monitoring/standalone-vps/${vpsId}/stacks/${existing.id}`, parsed.data, { signal }) : api.post(`/monitoring/standalone-vps/${vpsId}/stacks`, parsed.data, { signal }));
      if (result) { toast.success(existing ? "Serviço atualizado." : "Serviço cadastrado."); onSaved(); }
    } catch (failure) { setError(errorText(failure)); }
  });
  return <form onSubmit={submit} className="admin-form"><fieldset disabled={mutation.busy}><div className="admin-fields">
    <Field label="Nome"><input maxLength={120} {...form.register("name")} /></Field>
    <Field label="Link"><input maxLength={2048} {...form.register("link")} placeholder="https://servico.exemplo" /></Field>
    <Field className="admin-field-span" label="Anotações"><textarea maxLength={2000} {...form.register("notes")} /></Field>
  </div></fieldset>{error && <p role="alert" className="admin-error">{error}</p>}<div className="admin-actions"><Button type="submit" variant="primary" disabled={mutation.busy}>{mutation.busy ? "Salvando…" : "Salvar serviço"}</Button><Button type="button" disabled={mutation.busy} onClick={onCancel}>Cancelar</Button></div></form>;
}
export function VpsDetail({ id }: { id: string }) {
  const detail = useAdminRead(`/monitoring/standalone-vps/${id}`, parseDetail), mutation = useMutation(), router = useRouter(), editor = useCanEdit(), place = usePlaceHref();
  const publicRead = isPublicPath(usePathname());
  const authenticated = useAuthStore(state => state.status === "authenticated");
  const [editing, setEditing] = useState(false), [stack, setStack] = useState<VpsStackRecord | "new" | null>(null), [viewing, setViewing] = useState<VpsStackRecord | null>(null);
  const item = detail.data;
  useEffect(() => { setEditing(false); setStack(null); setViewing(null); }, [id]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { if (authenticated) detail.refresh(); }, [authenticated, detail.refresh]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    const tick = () => { if (!document.hidden) detail.refresh(); };
    const timer = setInterval(tick, probeLiveRefreshMs);
    document.addEventListener("visibilitychange", tick);
    return () => { clearInterval(timer); document.removeEventListener("visibilitychange", tick); };
  }, [detail.refresh]);
  async function setPaused(paused: boolean) {
    if (!item) return;
    const updated = await mutation.run(signal => api.patch(`/monitoring/standalone-vps/${item.id}`, { monitorPaused: paused, expectedRevision: item.revision }, { signal }));
    if (!updated) throw new Error("vps_pause_failed");
    toast.success(paused ? "Monitor pausado." : "Monitor retomado.");
    detail.refresh();
  }
  async function setEnabled(enabled: boolean) {
    if (!item) return;
    const updated = await mutation.run(signal => api.patch(`/monitoring/standalone-vps/${item.id}`, { enabled, expectedRevision: item.revision }, { signal }));
    if (!updated) throw new Error("vps_state_failed");
    toast.success(enabled ? "VPS ativada." : "VPS inativada.");
    detail.refresh();
  }
  async function remove() {
    if (!item) return;
    const removed = await mutation.run(signal => api.delete(`/monitoring/standalone-vps/${item.id}`, { signal }));
    if (!removed) return;
    toast.success("VPS removida.");
    router.push(place("/admin/vps") ?? "/admin/vps");
  }
  async function removeStack(current: VpsStackRecord) {
    if (!item) return;
    const removed = await mutation.run(signal => api.delete(`/monitoring/standalone-vps/${item.id}/stacks/${current.id}`, { signal }));
    if (!removed) return;
    toast.success("Serviço removido.");
    detail.refresh();
  }
  return <div className="admin-page">
    <p><PlaceLink href="/admin/vps">Voltar para VPS</PlaceLink></p>
    {detail.failed && <ReadError refresh={detail.refresh}>Não foi possível ler esta VPS.</ReadError>}
    {detail.loading && !item && <p className="panel-empty">Carregando VPS…</p>}
    {item && <VpsBody item={item} editor={editor} authenticated={authenticated} publicRead={publicRead} editing={editing} setEditing={setEditing} onReload={detail.refresh} setEnabled={setEnabled} setPaused={setPaused} remove={remove} stack={stack} setStack={setStack} viewing={viewing} setViewing={setViewing} removeStack={removeStack} />}
  </div>;
}
function VpsBody({ item, editor, authenticated, publicRead, editing, setEditing, onReload, setEnabled, setPaused, remove, stack, setStack, viewing, setViewing, removeStack }: {
  item: StandaloneVpsDetail; editor: boolean; authenticated: boolean; publicRead: boolean; editing: boolean; setEditing: (value: boolean) => void; onReload: () => void;
  setEnabled: (enabled: boolean) => Promise<void>; setPaused: (paused: boolean) => Promise<void>; remove: () => Promise<void>; stack: VpsStackRecord | "new" | null; setStack: (value: VpsStackRecord | "new" | null) => void; viewing: VpsStackRecord | null; setViewing: (value: VpsStackRecord | null) => void; removeStack: (stack: VpsStackRecord) => Promise<void>;
}) {
  const availability = vpsAvailability(item.enabled);
  const monitor = vpsMonitorLabel(item.monitorState);
  const reading = item.result;
  const showMeters = item.enabled && !item.monitorPaused && item.monitorConfigured && item.monitorState !== "pending" && reading && (reading.cpuPercent !== null || reading.memoryPercent !== null || reading.diskPercent !== null || reading.disks.length > 0);
  const _tracksOnly = !showMeters;
  const busiest = reading?.disks.length ? reading.disks.reduce((best, disk) => (disk.use ?? -1) > (best.use ?? -1) ? disk : best) : undefined;
  return <>
    <section className="dashboard-panel app-monitor-detail" aria-label={item.name}>
      <div className="panel-heading"><div>
        <span className={`app-presence tone-${availability.tone}`}>{availability.label}</span>
        <h2>{item.name}</h2>
        {item.provider && <p className="app-monitor-meta">{item.provider}</p>}
        <p>{item.ip}{item.domain ? ` · ${item.domain}` : ""}</p>
        {monitor && <p className={`vps-monitor tone-${monitor.tone}`}>{monitor.label}</p>}
        {authenticated && item.managerUrl && <a href={item.managerUrl} target="_blank" rel="noreferrer">Abrir manager</a>}
      </div>{editor && <div className="admin-actions app-monitor-actions">
        <Button type="button" size="icon" aria-label="Editar" title="Editar" onClick={() => setEditing(true)}><Pencil aria-hidden="true" /></Button>
        {item.monitorConfigured && (item.monitorPaused
          ? <ConfirmationDialog trigger={<Button type="button" size="icon" aria-label="Retomar monitor" title="Retomar monitor"><Play aria-hidden="true" /></Button>} title="Retomar monitor?" description="A consulta volta na próxima rodada e a faixa recomeça vazia, da primeira posição. O histórico já guardado permanece. Nenhum recurso do Zabbix será alterado." confirmLabel="Retomar monitor" onConfirm={() => setPaused(false)} />
          : <ConfirmationDialog trigger={<Button type="button" size="icon" aria-label="Pausar monitor" title="Pausar monitor"><Pause aria-hidden="true" /></Button>} title="Pausar monitor?" description="A consulta para na próxima rodada e a faixa zera. O cadastro e o histórico permanecem. Nenhum recurso do Zabbix será alterado." confirmLabel="Pausar monitor" onConfirm={() => setPaused(true)} />)}
        {item.enabled
          ? <ConfirmationDialog trigger={<Button type="button" size="icon" aria-label="Inativar" title="Inativar"><Power aria-hidden="true" /></Button>} title="Inativar VPS?" description="A coleta desta VPS para na próxima rodada. O cadastro e os serviços permanecem. Nenhum recurso do Zabbix será alterado." confirmLabel="Inativar VPS" onConfirm={() => setEnabled(false)} />
          : <ConfirmationDialog trigger={<Button type="button" size="icon" aria-label="Ativar" title="Ativar"><Power aria-hidden="true" /></Button>} title="Ativar VPS?" description="A VPS volta a ficar disponível. Se houver monitor cadastrado, a coleta retoma na próxima rodada. Nenhum recurso do Zabbix será alterado." confirmLabel="Ativar VPS" onConfirm={() => setEnabled(true)} />}
        <ConfirmationDialog trigger={<Button type="button" size="icon" variant="destructive" aria-label="Remover" title="Remover"><Trash2 aria-hidden="true" /></Button>} title="Remover VPS?" description="A VPS, os serviços e as amostras serão apagados. Nenhum recurso do Zabbix será alterado." confirmLabel="Remover VPS" destructive onConfirm={remove} />
      </div>}</div>
      <div className="app-monitor-body">
        {!item.enabled && <p className="vps-notice">Inativa. A consulta não roda.</p>}
        {item.enabled && item.monitorPaused && <p className="vps-notice">Pausada. A faixa zera e recomeça ao retomar.</p>}
        <ProbeStrip reasons={vpsStrip(item.enabled, item.monitorConfigured, item.strip, item.monitorPaused)} variant="track" colorFor={vpsReasonColor} />
        {item.enabled && item.monitorState === "pending" && <p className="vps-monitor tone-unknown">Aguardando consulta</p>}
        {item.enabled && item.monitorState === "down" && <p className="vps-monitor tone-bad">Fora do ar</p>}
        <div className={`vps-resource-board ${item.monitorState === "down" ? "metric-old" : ""}`}>
          <section className="vps-metric-panel" aria-label="Recursos">
            <h3><Activity aria-hidden="true" />Recursos</h3>
            <MetricRow series="cpu" icon={<Cpu aria-hidden="true" />} label="CPU" hint={[reading?.cpu?.cores != null ? `${reading.cpu.cores} núcleos` : null, reading?.cpu?.speed].filter(Boolean).join(" · ")} value={reading?.cpuPercent ?? null} fill={!!showMeters} />
            <MetricRow series="memory" icon={<MemoryStick aria-hidden="true" />} label="Memória" hint={[reading?.memory?.used, reading?.memory?.total].filter(Boolean).join(" / ")} value={reading?.memoryPercent ?? null} fill={!!showMeters} />
            <MetricRow series="disk" icon={<HardDrive aria-hidden="true" />} label="Disco" hint={busiest?.size ?? [busiest?.used, busiest?.mount].filter(Boolean).join(" · ")} value={reading?.diskPercent ?? null} fill={!!showMeters} />
          </section>
          <section className="vps-metric-panel" aria-label="Núcleos">
            <h3><Cpu aria-hidden="true" />Núcleos</h3>
            {showMeters && reading && !!reading.cpu.coresLoad.length
              ? <ul className="vps-core-grid">{reading.cpu.coresLoad.map(core => <li key={core.core}><header><span>Núcleo {core.core}</span><strong>{percent(core.load) ?? "—"}</strong></header><UsageMeter series="cpu" value={core.load} fill={core.load !== null} /></li>)}</ul>
              : <p className="vps-notice">Sem leitura de núcleos.</p>}
          </section>
        </div>
        {showMeters && reading && !!reading.disks.length && <ul className="vps-disk-list">{reading.disks.map((disk, index) => <li key={`${disk.device ?? "disco"}-${index}`}><header><HardDrive aria-hidden="true" /><span>{disk.device || "Disco"}{disk.mount ? ` · ${disk.mount}` : ""}</span><small>{[disk.used, disk.size].filter(Boolean).join(" / ")}</small><strong>{percent(disk.use) ?? "—"}</strong></header><UsageMeter series="disk" value={disk.use} fill={disk.use !== null} /></li>)}</ul>}
        {item.monitorState === "down" && reading && <p className="app-monitor-meta">Leitura anterior{reading.checkedAt ? ` · ${timestamp(reading.checkedAt)}` : ""}</p>}
        {showMeters && reading?.checkedAt && item.monitorState !== "down" && <time dateTime={reading.checkedAt}>{timestamp(reading.checkedAt)}</time>}
      </div>
    </section>
    {!publicRead && <section className="dashboard-panel vps-stacks" aria-label="Serviços"><div className="panel-heading"><h2>Serviços</h2>{editor && <Button type="button" variant="primary" onClick={() => setStack("new")}>Novo serviço</Button>}</div>
      <ul>{item.stacks.map(current => <li key={current.id}><div><strong>{current.name}</strong>{current.link && <a href={current.link} target="_blank" rel="noreferrer">{current.link}</a>}</div>
        <div className="admin-actions app-monitor-actions">
          {current.notes && <Button type="button" size="icon" aria-label={`Ver anotações de ${current.name}`} title="Ver anotações" onClick={() => setViewing(current)}><Eye aria-hidden="true" /></Button>}
          {editor && <><Button type="button" size="icon" aria-label={`Editar serviço ${current.name}`} title="Editar" onClick={() => setStack(current)}><Pencil aria-hidden="true" /></Button>
            <ConfirmationDialog trigger={<Button type="button" size="icon" variant="destructive" aria-label={`Remover serviço ${current.name}`} title="Remover"><Trash2 aria-hidden="true" /></Button>} title="Remover serviço?" description="O serviço sai deste cadastro. A VPS e o monitor não são alterados." confirmLabel="Remover serviço" destructive onConfirm={() => removeStack(current)} /></>}
        </div>
      </li>)}{!item.stacks.length && <li className="app-monitor-empty">Nenhum serviço cadastrado.</li>}</ul>
    </section>}
    <Dialog open={editing} onOpenChange={setEditing}><DialogContent className="vps-dialog"><DialogHeader><DialogTitle>Editar VPS</DialogTitle><DialogDescription>O cadastro fica no Pulse.</DialogDescription></DialogHeader><DialogBody><VpsForm key={`${item.id}:${item.revision}`} existing={item} onSaved={() => { setEditing(false); onReload(); }} onCancel={() => setEditing(false)} onReload={onReload} /></DialogBody></DialogContent></Dialog>
    <Dialog open={stack !== null} onOpenChange={open => { if (!open) setStack(null); }}><DialogContent><DialogHeader><DialogTitle>{stack && stack !== "new" ? "Editar serviço" : "Novo serviço"}</DialogTitle><DialogDescription>Nome, link e anotações ficam neste cadastro.</DialogDescription></DialogHeader><DialogBody>{stack && <StackForm vpsId={item.id} existing={stack === "new" ? undefined : stack} onSaved={() => { setStack(null); onReload(); }} onCancel={() => setStack(null)} />}</DialogBody></DialogContent></Dialog>
    <Dialog open={viewing !== null} onOpenChange={open => { if (!open) setViewing(null); }}><DialogContent><DialogHeader><DialogTitle>{viewing?.name ?? "Serviço"}</DialogTitle><DialogDescription>Anotações deste serviço.</DialogDescription></DialogHeader><DialogBody>{viewing?.link && <a className="vps-stack-link" href={viewing.link} target="_blank" rel="noreferrer">{viewing.link}</a>}{viewing?.notes ? <p className="vps-stack-notes">{viewing.notes}</p> : <p className="panel-empty">Sem anotações.</p>}</DialogBody></DialogContent></Dialog>
  </>;
}
