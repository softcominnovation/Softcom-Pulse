"use client";

import { useContext, useEffect, useId, useRef, useState } from "react";
import { EvidenceTimeContext } from "@/components/dashboard/metrics";
import { usePathname } from "next/navigation";
import { isPublicPath } from "@/lib/public/paths";
import { api } from "@/lib/client/api";
import { useCanEdit } from "@/store/auth.store";
import { agentCapacityRequiredMessage, type AgentMonitoring, type CardMetric } from "@/lib/config/agent-monitoring";
import type { Host, Metrics } from "@/lib/monitoring/contracts";
import { filesystemCapacity } from "@/lib/monitoring/filesystem-capacity";
import { metricValue } from "@/lib/dashboard/format";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Field, Check, errorText } from "./shared";
import { TargetNotificationSettings } from "@/components/notifications/settings";
import { CardReadings } from "@/components/dashboard/card-readings";
import "@/components/dashboard/availability.css";

type Data = { demo?: boolean; name: string; resourceId: string | null; revision: number; eligible: boolean; stale: boolean; bindingValid: boolean; currentVmBinding: AgentMonitoring["vmBinding"] | null; settings: AgentMonitoring | null; cardMetrics?: CardMetric[]; metricsSource: string; critical: boolean; monitoringEnabled: boolean; notificationEnabled: boolean; soundEnabled: boolean; volumes: Host["filesystems"]; metrics: Metrics };
export function AgentMonitoringDialog({ hostKey }: { hostKey: string | null | undefined }) {
  const editor = useCanEdit(), pathname = usePathname(), [open, setOpen] = useState(false);
  if (!editor || !hostKey || isPublicPath(pathname ?? "")) return null;
  return <><Button type="button" size="sm" className="agent-monitoring-trigger" onClick={() => setOpen(true)}>Alertas e exibição</Button>
    <Dialog open={open} onOpenChange={setOpen}><DialogContent className="w-[42rem] max-w-[calc(100vw-2rem)] max-h-[calc(100dvh-2rem)]"><DialogHeader><DialogTitle>Alertas e exibição da VM</DialogTitle><DialogDescription>Limites do Agent, armazenamento monitorado e métricas do minicard.</DialogDescription></DialogHeader><DialogBody>{open && <AgentMonitoringEditor hostKey={hostKey} />}</DialogBody></DialogContent></Dialog>
  </>;
}
function AgentMonitoringEditor({ hostKey }: { hostKey: string }) {
  const clock = useContext(EvidenceTimeContext);
  const [openedAt] = useState(() => Date.now());
  const [data, setData] = useState<Data | null>(null), [draft, setDraft] = useState<AgentMonitoring | null>(null);
  const [pair, setPair] = useState("cpu,memory"), [source, setSource] = useState("hypervisor"), [critical, setCritical] = useState(false);
  const [saved, setSaved] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const [capacityError, setCapacityError] = useState("");
  const capacityGroup = useRef<HTMLFieldSetElement>(null), capacityId = useId();
  useEffect(() => {
    const controller = new AbortController();
    void api.get(`/settings/agent-monitoring/${encodeURIComponent(hostKey)}`, { signal: controller.signal }).then(response => {
      const next = response.data.data as Data;
      setData(next); setDraft(next.settings); setPair((next.cardMetrics ?? ["cpu", "memory"]).join(",")); setSource(next.metricsSource); setCritical(next.critical);
    }).catch(failure => { if (!controller.signal.aborted) setError(errorText(failure)); });
    return () => controller.abort();
  }, [hostKey]);
  if (!data || !draft) return <p role="status">{error || (data ? "Agent sem vínculo de VM disponível. Confira a associação no inventário." : "Carregando configuração…")}</p>;
  const capacity = filesystemCapacity(data.volumes, draft.capacity);
  const value = (kind: CardMetric) => {
    const metric = kind === "cpu" ? data.metrics.cpuUsagePercent : kind === "memory" ? data.metrics.memoryUsagePercent : capacity.usagePercent;
    return !data.stale && metric?.quality === "fresh" && metric.value !== null && metric.validUntil && Date.parse(metric.validUntil) > (clock || openedAt) ? metric.value : null;
  };
  const save = async () => {
    setError(""); setCapacityError(""); setSaved(false);
    const missingCapacity = (draft.thresholds.disk !== null || pair.split(",").includes("disk")) && !draft.capacity.filesystemKeys.length;
    const missingConfirmation = draft.capacity.filesystemKeys.length > 1 && !draft.capacity.independentVolumesConfirmed;
    if (missingCapacity || missingConfirmation) {
      setCapacityError(missingCapacity ? agentCapacityRequiredMessage : "Confirme que os volumes selecionados são independentes e não duplicam a mesma capacidade.");
      capacityGroup.current?.focus();
      capacityGroup.current?.scrollIntoView({ block: "center" });
      return;
    }
    setBusy(true);
    try {
      const response = await api.put(`/settings/agent-monitoring/${encodeURIComponent(hostKey)}`, { expectedRevision: data.revision, vmBinding: draft.vmBinding, capacity: draft.capacity, thresholds: draft.thresholds, cardMetrics: pair.split(","), metricsSource: source, critical });
      setData(response.data.data); setDraft(response.data.data.settings); setSaved(true); window.dispatchEvent(new Event("pulse:preferences-changed"));
      setError("");
    } catch (failure) { setError(errorText(failure)); }
    finally { setBusy(false); }
  };
  const changeCapacity = (capacity: AgentMonitoring["capacity"]) => { setDraft({ ...draft, capacity }); setCapacityError(""); setSaved(false); };
  return <div className="admin-form space-y-4">
    <p className="font-semibold">{data.name}</p><p className="text-sm text-muted-foreground">Uma configuração por Agent, compartilhada com ASGARD e Signal. Os alertas continuam ativos ao desvincular a VM do Signal.</p>
    {data.demo && <p role="status">Demonstração: os valores são simulados e as alterações não são persistidas.</p>}
    {data.stale && <p role="status">Leitura indisponível ou antiga. Limites existentes podem ser editados; novos vínculos e volumes exigem leitura atual.</p>}
    {!data.bindingValid && <p role="status">A associação da VM mudou ou está ausente. Os alertas de uso ficam suspensos até revisar o vínculo.{data.eligible && data.currentVmBinding && <Button type="button" onClick={() => { setDraft({ ...draft, vmBinding: data.currentVmBinding!, capacity: { filesystemKeys: [], independentVolumesConfirmed: false }, thresholds: { ...draft.thresholds, disk: null } }); setSaved(false); }}>Usar vínculo atual da VM</Button>}</p>}
    <fieldset disabled={busy} className="space-y-3"><legend className="font-semibold">Alertas de uso · Agent</legend>
      {(["cpu", "memory", "disk"] as CardMetric[]).map(kind => <div key={kind} className="flex flex-wrap items-center gap-3">
        <Check label={`Alertar ${kind === "memory" ? "RAM" : kind === "disk" ? "disco" : "CPU"}`}><input type="checkbox" checked={draft.thresholds[kind] !== null} onChange={event => setDraft({ ...draft, thresholds: { ...draft.thresholds, [kind]: event.target.checked ? 70 : null } })} /></Check>
        <Field label={`Limite de ${kind === "memory" ? "RAM" : kind === "disk" ? "disco" : "CPU"} (%)`}><input type="number" min={1} max={100} disabled={draft.thresholds[kind] === null} value={draft.thresholds[kind] ?? ""} onChange={event => setDraft({ ...draft, thresholds: { ...draft.thresholds, [kind]: Number(event.target.value) } })} /></Field>
        <small>Atual: {value(kind) === null ? "—" : `${value(kind)!.toFixed(1)}%`}</small>
        {draft.thresholds[kind] !== null && value(kind) !== null && value(kind)! >= draft.thresholds[kind]! && <small role="status">Já acima do limite; o aviso depende de novas amostras e da política.</small>}
      </div>)}
      <p className="text-xs text-muted-foreground">CPU/RAM: confirmar por 60s. Disco: 30s. Sempre duas amostras novas; a frequência do Zabbix pode prolongar esse prazo. Recuperação usa margem de até 5 pontos.</p>
      <Check label="Recurso crítico"><input type="checkbox" checked={critical} onChange={event => setCritical(event.target.checked)} /></Check>
      {!data.monitoringEnabled && <p role="status">O recurso está pausado. Os limites só serão acompanhados após sua habilitação em Recursos.</p>}
      {!data.notificationEnabled && <p role="status">A política atual não permite avisos de uso deste recurso. Confira criticidade, habilitação e a exceção abaixo; salvar não muda a política geral.</p>}
      <fieldset ref={capacityGroup} tabIndex={-1} aria-invalid={!!capacityError} aria-describedby={`${capacityId}-help${capacityError ? ` ${capacityId}-error` : ""}`} className={`min-w-0 space-y-2 rounded-xl border p-3 ${capacityError ? "border-destructive" : "border-border"}`}>
      <legend className="px-1 font-semibold">Armazenamento monitorado</legend><p id={`${capacityId}-help`} className="text-xs">Obrigatório para alertar disco ou mostrar Disco no minicard. Marque abaixo os volumes que compõem o total; CPU e RAM podem permanecer desmarcados. 70% significa ocupado. Não some bind mounts ou volumes com capacidade compartilhada.</p>
      {!data.volumes.length && <p role="status" className="text-xs">Nenhum volume disponível nesta leitura. Aguarde uma leitura atual do Agent para configurar o disco.</p>}
      {capacityError && <p id={`${capacityId}-error`} role="alert" className="admin-error">{capacityError}</p>}
      {data.volumes.map(volume => <Check key={volume.key} label={`${volume.name}${volume.filesystemType ? ` · ${volume.filesystemType}` : ""} · ${metricValue(volume.metrics.diskUsedBytes)} / ${metricValue(volume.metrics.diskTotalBytes)} · ${metricValue(filesystemCapacity([volume]).usagePercent)}`}><input type="checkbox" disabled={!data.eligible} checked={draft.capacity.filesystemKeys.includes(volume.key)} onChange={event => changeCapacity({ filesystemKeys: event.target.checked ? [...draft.capacity.filesystemKeys, volume.key] : draft.capacity.filesystemKeys.filter(key => key !== volume.key), independentVolumesConfirmed: false })} /></Check>)}
      {draft.capacity.filesystemKeys.filter(key => !data.volumes.some(v => v.key === key)).map(key => <Check key={key} label="Volume configurado ausente"><input type="checkbox" checked onChange={() => changeCapacity({ filesystemKeys: draft.capacity.filesystemKeys.filter(k => k !== key), independentVolumesConfirmed: false })} /></Check>)}
      {draft.capacity.filesystemKeys.length > 1 && <Check label="Confirmo que os volumes são independentes e não duplicam a mesma capacidade"><input type="checkbox" checked={draft.capacity.independentVolumesConfirmed} onChange={event => changeCapacity({ ...draft.capacity, independentVolumesConfirmed: event.target.checked })} /></Check>}
      <p>Total selecionado: {metricValue(capacity.usedBytes)} / {metricValue(capacity.totalBytes)} · {metricValue(capacity.usagePercent)}{capacity.coverage !== "complete" ? " · capacidade incompleta/não configurada" : ""}</p>
      </fieldset>
      <h3 className="font-semibold">Minicard</h3><Field label="Métricas do minicard"><select value={pair} onChange={event => setPair(event.target.value)}><option value="cpu,memory">CPU e RAM</option><option value="cpu,disk">CPU e Disco</option><option value="disk,memory">Disco e RAM</option></select></Field>
      <Field label="Fonte de CPU e RAM do minicard"><select value={source} onChange={event => setSource(event.target.value)}><option value="hypervisor">Hipervisor · padrão existente</option><option value="agent">Agent · mesma fonte dos alertas</option><option value="auto">Automática · padrão existente</option></select></Field>
      <p className="text-xs">Prévia das métricas do Agent. CPU/RAM do card mantêm a fonte escolhida acima; o disco sempre é do Agent.</p>
      <div className="availability-card"><span className="availability-state">Prévia · Agent</span><strong className="availability-name">{data.name}</strong><span className="availability-description">Armazenamento monitorado</span><CardReadings pair={pair.split(",") as CardMetric[]} values={{ cpu: value("cpu"), memory: value("memory"), disk: value("disk") }} /><span className="availability-footer">{draft.capacity.filesystemKeys.length} volumes selecionados</span></div>
    </fieldset>
    {saved && <p role="status">Alertas e exibição salvos.</p>}
    {error && <p role="alert" className="admin-error">{error}</p>}
    <Button type="button" variant="primary" disabled={busy} onClick={() => void save()}>{busy ? "Salvando…" : "Salvar alertas e exibição"}</Button>
    <TargetNotificationSettings targetRef={data.resourceId ? `resource:${data.resourceId}` : undefined} />
  </div>;
}
