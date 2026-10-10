"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Pause, Pencil, Play, Plus, Trash2, Unlink } from "lucide-react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";
import { isAxiosError } from "axios";
import { api } from "@/lib/client/api";
import { requestCanceled } from "@/lib/client/request-canceled";
import { signalInfraRoles, signalTargetWriteSchema } from "@/lib/config/signal-targets";
import { hostSchema } from "@/lib/monitoring/contracts";
import { number, timestamp } from "@/lib/dashboard/format";
import { ProbeStrip } from "@/components/dashboard/probe-strip";
import { ConfirmationDialog } from "@/components/confirmation-dialog";
import { Button } from "@/components/ui/button";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Check, Field, errorText, useMutation } from "@/components/admin/shared";
import { signalStateColor, signalStateLabel, signalStateTone, signalWorkersLabel } from "@/lib/signal/labels";
import { useCanEdit } from "@/store/auth.store";
import "./signal-services.css";

const linkSchema = z.object({
  id: z.string(), role: z.string(), label: z.string().nullable(), hostKey: z.string(),
  vmKey: z.string().nullable(), parentHostKey: z.string().nullable(), inventoryStatus: z.string(),
  inventoryName: z.string().nullable().optional(), inventoryAvailability: z.string().nullable().optional(),
  cpuUsagePercent: z.number().nullable().optional(), memoryUsagePercent: z.number().nullable().optional(),
});
const targetSchema = z.object({
  id: z.string(), displayName: z.string(), description: z.string().nullable(), baseUrl: z.string(),
  enabled: z.boolean(), dashboardEnabled: z.boolean(), critical: z.boolean(), displayOrder: z.number(),
  timeoutMs: z.number(), revision: z.number(), state: z.number(), latencyMs: z.number().nullable(),
  httpStatus: z.number().nullable(), liveOk: z.boolean().nullable(), readyStatus: z.string().nullable(),
  workerStatus: z.string().nullable(), activeInstances: z.number().nullable(),
  outboxPending: z.number().nullable(), inboxPending: z.number().nullable(),
  outboxDead: z.number().nullable(), inboxDead: z.number().nullable(),
  oldestOutboxSeconds: z.number().nullable(), oldestInboxSeconds: z.number().nullable(),
  checks: z.record(z.string(), z.unknown()).nullable(), strip: z.array(z.number()),
  uptime24h: z.object({ available: z.number(), total: z.number() }).nullable(),
  uptime7d: z.object({ available: z.number(), total: z.number() }).nullable().optional(),
  uptime30d: z.object({ available: z.number(), total: z.number() }).nullable().optional(),
  checkedAt: z.string().nullable(), links: z.array(linkSchema),
});
type Target = z.infer<typeof targetSchema>;
type AgentVm = { parentHostKey: string; vmKey: string; name: string; linuxHostKey: string; state: string };

const roleLabels: Record<string, string> = {
  manager: "Manager", worker: "Worker", admin: "Admin", other: "Outro",
};

function pct(window: { available: number; total: number } | null | undefined) {
  if (!window || !window.total) return "—";
  return `${Math.round((window.available / window.total) * 100)}%`;
}
function metricText(value: unknown) {
  if (value == null) return "—";
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return String(value);
  if (typeof value === "object" && value && "status" in value) return String((value as { status?: unknown }).status ?? "—");
  return JSON.stringify(value);
}
function countLabel(value: number | null | undefined) {
  return value == null ? "—" : String(value);
}
function ageLabel(seconds: number | null | undefined) {
  if (seconds == null) return "—";
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)} min`;
  return `${Math.floor(seconds / 3600)} h`;
}

export function SignalServicesPanel() {
  const editor = useCanEdit();
  const mutation = useMutation();
  const [target, setTarget] = useState<Target | null>(null);
  const [agentVms, setAgentVms] = useState<AgentVm[]>([]);
  const [failed, setFailed] = useState(false);
  const [editing, setEditing] = useState(false);
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkRole, setLinkRole] = useState<typeof signalInfraRoles[number]>("worker");
  const [linkQuery, setLinkQuery] = useState("");
  const [linkError, setLinkError] = useState("");

  const [revision, setRevision] = useState(0);
  const refresh = useCallback(() => setRevision(value => value + 1), []);

  useEffect(() => {
    const controller = new AbortController();
    void Promise.all([
      api.get("/monitoring/signal-targets", { signal: controller.signal }),
      api.get("/monitoring/hosts", { signal: controller.signal }),
    ]).then(([targetsRes, hostsRes]) => {
      const items = z.object({ data: z.array(targetSchema) }).parse(targetsRes.data).data;
      setTarget(items[0] ?? null);
      const hosts = z.object({ data: z.array(hostSchema) }).passthrough().parse(hostsRes.data).data;
      const vms: AgentVm[] = [];
      for (const host of hosts) {
        for (const vm of host.vms) {
          if (!vm.linuxHostKey || vm.name.startsWith("tpl")) continue;
          vms.push({
            parentHostKey: host.hostKey, vmKey: vm.vmKey,
            name: vm.displayName ?? vm.name, linuxHostKey: vm.linuxHostKey, state: vm.state,
          });
        }
      }
      vms.sort((a, b) => a.name.localeCompare(b.name, "pt"));
      setAgentVms(vms);
      setFailed(false);
    }).catch(error => {
      if (controller.signal.aborted || requestCanceled(error)) return;
      setFailed(true);
    });
    return () => controller.abort();
  }, [revision]);

  useEffect(() => {
    const timer = setInterval(() => { if (!document.hidden) refresh(); }, 15_000);
    return () => clearInterval(timer);
  }, [refresh]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (window.location.hash === "#signal") {
      document.getElementById("signal")?.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, [target]);

  const linkedKeys = useMemo(() => new Set(target?.links.map(link => `${link.parentHostKey ?? link.hostKey}:${link.vmKey ?? ""}`) ?? []), [target]);
  const availableVms = useMemo(() => {
    const q = linkQuery.trim().toLowerCase();
    return agentVms.filter(vm => {
      if (linkedKeys.has(`${vm.parentHostKey}:${vm.vmKey}`)) return false;
      if (!q) return true;
      return [vm.name, vm.parentHostKey, vm.vmKey, vm.linuxHostKey, vm.state].some(part => part.toLowerCase().includes(q));
    });
  }, [agentVms, linkedKeys, linkQuery]);
  const checks = target?.checks ?? null;
  const worker = checks?.worker && typeof checks.worker === "object" ? checks.worker as Record<string, unknown> : null;
  const knowledge = checks?.knowledgeIndex && typeof checks.knowledgeIndex === "object" ? checks.knowledgeIndex as Record<string, unknown> : null;

  async function setRunning(enabled: boolean) {
    if (!target) return;
    await mutation.run(signal => api.patch(`/monitoring/signal-targets/${target.id}`, { enabled, expectedRevision: target.revision }, { signal }));
    toast.success(enabled ? "Signal retomado." : "Signal pausado.");
    refresh();
  }
  async function removeTarget() {
    if (!target) return;
    await mutation.run(signal => api.delete(`/monitoring/signal-targets/${target.id}`, { signal }));
    toast.success("Alvo Signal removido.");
    setTarget(null);
    refresh();
  }
  async function linkVm(vm: AgentVm) {
    if (!target) return;
    setLinkError("");
    try {
      await mutation.run(signal => api.post(`/monitoring/signal-targets/${target.id}/links`, {
        expectedRevision: target.revision, role: linkRole, label: vm.name,
        hostKey: vm.parentHostKey, vmKey: vm.vmKey, parentHostKey: vm.parentHostKey,
      }, { signal }));
      toast.success(`Vinculada: ${vm.name}`);
      refresh();
    } catch (failure) { setLinkError(errorText(failure)); }
  }
  async function unlink(linkId: string) {
    if (!target) return;
    await mutation.run(signal => api.delete(`/monitoring/signal-targets/${target.id}/links/${linkId}`, {
      data: { expectedRevision: target.revision }, signal,
    }));
    toast.success("Vínculo removido.");
    refresh();
  }

  return <div id="signal" className="signal-services">
    <section className="dashboard-panel signal-service-panel" aria-label="Softcom Signal">
      <div className="panel-heading signal-service-heading">
        <div className="signal-service-title">
          {target
            ? <span className={`app-presence tone-${target.enabled ? signalStateTone(target.state) : "unknown"}`}>{target.enabled ? signalStateLabel(target.state) : "Pausado"}</span>
            : null}
          <h2>{target?.displayName ?? "Softcom Signal"}</h2>
          <p className="app-monitor-meta">{target?.baseUrl ?? "Nenhum alvo cadastrado. Defina SIGNAL_API_BASE_URL ou cadastre pelo formulário."}</p>
          {target && <p className="app-monitor-meta">
            {signalWorkersLabel(target.activeInstances, target.checkedAt)}
            {target.latencyMs !== null ? ` · ${target.latencyMs} ms` : ""}
            {target.dashboardEnabled ? " · Em destaque" : " · Sem destaque"}
            {target.checkedAt ? ` · ${timestamp(target.checkedAt)}` : ""}
          </p>}
        </div>
        {editor && target && <div className="admin-actions app-monitor-actions signal-service-actions">
          <Button type="button" size="icon" aria-label="Editar" title="Editar" onClick={() => setEditing(true)}><Pencil aria-hidden="true" /></Button>
          {target.enabled
            ? <ConfirmationDialog trigger={<Button type="button" size="icon" aria-label="Pausar" title="Pausar"><Pause aria-hidden="true" /></Button>} title="Pausar Signal?" description="O worker deixa de consultar este alvo na próxima rodada." confirmLabel="Pausar" onConfirm={() => setRunning(false)} />
            : <ConfirmationDialog trigger={<Button type="button" size="icon" aria-label="Retomar" title="Retomar"><Play aria-hidden="true" /></Button>} title="Retomar Signal?" description="O worker volta a consultar este alvo." confirmLabel="Retomar" onConfirm={() => setRunning(true)} />}
          <ConfirmationDialog trigger={<Button type="button" size="icon" variant="destructive" aria-label="Remover" title="Remover"><Trash2 aria-hidden="true" /></Button>} title="Remover Signal?" description="O cadastro, vínculos e histórico serão apagados." confirmLabel="Remover" destructive onConfirm={removeTarget} />
        </div>}
        {editor && !target && <Button type="button" variant="primary" className="signal-service-actions" onClick={() => setEditing(true)}>Cadastrar Signal</Button>}
      </div>

      {failed && <p className="panel-empty" role="alert">Não foi possível ler o Softcom Signal.</p>}

      {editor && editing && <SignalEditForm
        existing={target}
        onCancel={() => setEditing(false)}
        onSaved={async () => { setEditing(false); refresh(); }}
      />}

      {target && !editing && <>
        <div className="signal-strip-block">
          <ProbeStrip reasons={target.enabled ? target.strip : []} variant="track" colorFor={signalStateColor} />
          <p className="signal-uptime-line">Disponibilidade · 24h {pct(target.uptime24h)} · 7d {pct(target.uptime7d)} · 30d {pct(target.uptime30d)}</p>
        </div>

        <div className="signal-metrics-grid" aria-label="Métricas do ready">
          <MetricCard title="Resposta" rows={[
            ["HTTP", target.httpStatus ?? "—"],
            ["Live", target.liveOk === null ? "—" : target.liveOk ? "ok" : "falha"],
            ["Ready", target.readyStatus ?? "—"],
            ["Latência", target.latencyMs === null ? "—" : `${target.latencyMs} ms`],
          ]} />
          <MetricCard title="Worker" rows={[
            ["Status", target.workerStatus ?? "—"],
            ["Instâncias ativas", target.activeInstances ?? "—"],
            ["Último heartbeat", worker?.lastHeartbeatAt ? timestamp(String(worker.lastHeartbeatAt)) : "—"],
            ["Idade do heartbeat", worker?.ageSeconds != null ? `${worker.ageSeconds}s` : "—"],
          ]} />
          <PipelineCard
            outboxPending={target.outboxPending}
            outboxDead={target.outboxDead}
            inboxPending={target.inboxPending}
            inboxDead={target.inboxDead}
            oldestOutboxSeconds={target.oldestOutboxSeconds}
            oldestInboxSeconds={target.oldestInboxSeconds}
          />
          <MetricCard title="Dependências" rows={[
            ["Banco de dados", metricText(checks?.database)],
            ["Redis", metricText(checks?.redis)],
            ["Armazenamento", metricText(checks?.objectStorage)],
            ["Workdesk áudio", metricText(checks?.workdeskAudio)],
          ]} />
          <MetricCard title="Índice de conhecimento" rows={[
            ["Itens pendentes", metricText(knowledge?.itemsPending)],
            ["Indexando", metricText(knowledge?.itemsIndexing)],
            ["Com falha", metricText(knowledge?.itemsFailed)],
            ["Jobs na fila", metricText(knowledge?.jobsQueued)],
            ["Jobs em execução", metricText(knowledge?.jobsRunning)],
            ["Jobs com falha", metricText(knowledge?.jobsFailedCurrent)],
            ["Leases expirados", metricText(knowledge?.expiredLeases)],
            ["Sem job ativo", metricText(knowledge?.itemsWithoutActiveJob)],
          ]} />
        </div>

        <section className="signal-vm-links" aria-label="VMs vinculadas">
          <div className="panel-heading signal-linked-heading">
            <h3>VMs vinculadas</h3>
            {editor && <Button type="button" variant="primary" onClick={() => { setLinkOpen(true); setLinkError(""); setLinkQuery(""); }} disabled={target.links.length >= 20}>
              <Plus aria-hidden="true" />Vincular VM
            </Button>}
          </div>
          <p className="admin-muted">Máquinas do inventário associadas a este Signal (manager, workers etc.).</p>
          {target.links.length ? <ul className="signal-linked-grid">{target.links.map(link => {
            const vm = agentVms.find(item => item.parentHostKey === (link.parentHostKey ?? link.hostKey) && item.vmKey === link.vmKey);
            return <li key={link.id} className="signal-linked-card-wrap">
              <LinkedVmCard link={link} fallbackName={vm?.name} />
              {editor && <ConfirmationDialog
                trigger={<Button type="button" size="icon" variant="destructive" className="signal-linked-unlink" aria-label={`Desvincular ${link.label || link.vmKey || link.hostKey}`} title="Desvincular"><Unlink aria-hidden="true" /></Button>}
                title="Desvincular VM?"
                description="A VM deixa de aparecer neste Signal. O cadastro dela no inventário Zabbix permanece."
                confirmLabel="Desvincular"
                destructive
                onConfirm={() => unlink(link.id)}
              />}
            </li>;
          })}</ul> : <p className="panel-empty">Nenhuma VM vinculada. Use Vincular VM para associar manager ou workers.</p>}
        </section>

        <LinkVmDialog
          open={linkOpen}
          onOpenChange={setLinkOpen}
          role={linkRole}
          onRoleChange={setLinkRole}
          query={linkQuery}
          onQueryChange={setLinkQuery}
          vms={availableVms}
          error={linkError}
          busy={mutation.busy}
          atLimit={target.links.length >= 20}
          onLink={linkVm}
        />
      </>}
    </section>
  </div>;
}

type LinkItem = z.infer<typeof linkSchema>;

function linkAvailability(link: LinkItem) {
  if (link.inventoryStatus === "missing") return { label: "Sem inventário", tone: "unknown" as const };
  if (link.inventoryStatus === "stale") return { label: "Desatualizado", tone: "unknown" as const };
  const state = (link.inventoryAvailability ?? "").toLowerCase();
  if (["stopped", "dead", "unreachable"].includes(state)) return { label: "Indisponível", tone: "bad" as const };
  if (state && state !== "running" && state !== "reachable") {
    if (state === "paused") return { label: "Pausado", tone: "unknown" as const };
    return { label: "Sem estado", tone: "unknown" as const };
  }
  const cpu = link.cpuUsagePercent, ram = link.memoryUsagePercent;
  if (cpu != null && ram != null && cpu >= 90 && ram >= 90) return { label: "Atenção", tone: "warn" as const };
  return { label: "Disponível", tone: "good" as const };
}

function LinkedVmCard({ link, fallbackName }: { link: LinkItem; fallbackName?: string }) {
  const status = linkAvailability(link);
  const name = link.label || link.inventoryName || fallbackName || link.vmKey || link.hostKey;
  const role = roleLabels[link.role] ?? link.role;
  const ready = link.inventoryStatus === "ready";
  const cpu = link.cpuUsagePercent;
  const ram = link.memoryUsagePercent;
  const footerRight = link.inventoryStatus === "missing" ? "Sem leitura" : link.inventoryStatus === "stale" ? "Desatualizado" : ready ? "Inventário" : "Sem leitura";
  return <article className="availability-card signal-linked-card" aria-label={`${name}: ${status.label}`}>
    <span className={`availability-state tone-${status.tone}`}><i className="status-dot" />{status.label}</span>
    <strong className="availability-name">{name}</strong>
    <span className="availability-description">{role}</span>
    <span className="availability-readings">
      <span className="availability-reading"><span>CPU<strong>{ready && cpu != null ? `${number(cpu, 1)}%` : "—"}</strong></span><span className="availability-meter" aria-hidden="true"><i style={{ width: ready && cpu != null ? `${Math.max(0, Math.min(100, cpu))}%` : "0%" }} /></span></span>
      <span className="availability-reading"><span>RAM<strong>{ready && ram != null ? `${number(ram, 1)}%` : "—"}</strong></span><span className="availability-meter memory" aria-hidden="true"><i style={{ width: ready && ram != null ? `${Math.max(0, Math.min(100, ram))}%` : "0%" }} /></span></span>
    </span>
    <span className="availability-footer"><span>VM</span><strong>{footerRight}</strong></span>
  </article>;
}

function PipelineCard({
  outboxPending, outboxDead, inboxPending, inboxDead, oldestOutboxSeconds, oldestInboxSeconds,
}: {
  outboxPending: number | null; outboxDead: number | null; inboxPending: number | null; inboxDead: number | null;
  oldestOutboxSeconds: number | null; oldestInboxSeconds: number | null;
}) {
  return <article className="signal-metric-card signal-pipeline-card" aria-label="Filas de processamento">
    <h3>Filas de processamento</h3>
    <p className="signal-pipeline-lead">Mensagens aguardando ou em dead letter nas filas outbox e inbox.</p>
    <div className="signal-pipeline-lanes">
      <div className="signal-pipeline-lane">
        <h4>Saída · outbox</h4>
        <dl>
          <div><dt>Na fila</dt><dd>{countLabel(outboxPending)}</dd></div>
          <div className={(outboxDead ?? 0) > 0 ? "has-dead" : undefined}><dt>Dead letter</dt><dd>{countLabel(outboxDead)}</dd></div>
          <div><dt>Mais antiga</dt><dd>{ageLabel(oldestOutboxSeconds)}</dd></div>
        </dl>
      </div>
      <div className="signal-pipeline-lane">
        <h4>Entrada · inbox</h4>
        <dl>
          <div><dt>Na fila</dt><dd>{countLabel(inboxPending)}</dd></div>
          <div className={(inboxDead ?? 0) > 0 ? "has-dead" : undefined}><dt>Dead letter</dt><dd>{countLabel(inboxDead)}</dd></div>
          <div><dt>Mais antiga</dt><dd>{ageLabel(oldestInboxSeconds)}</dd></div>
        </dl>
      </div>
    </div>
  </article>;
}

function LinkVmDialog({
  open, onOpenChange, role, onRoleChange, query, onQueryChange, vms, error, busy, atLimit, onLink,
}: {
  open: boolean; onOpenChange: (open: boolean) => void;
  role: typeof signalInfraRoles[number]; onRoleChange: (role: typeof signalInfraRoles[number]) => void;
  query: string; onQueryChange: (value: string) => void;
  vms: AgentVm[]; error: string; busy: boolean; atLimit: boolean;
  onLink: (vm: AgentVm) => Promise<void>;
}) {
  return <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent className="signal-link-dialog" aria-describedby={undefined}>
      <DialogHeader>
        <DialogTitle>Vincular VM</DialogTitle>
        <DialogDescription>Escolha uma VM com Agent no inventário e o papel neste Signal.</DialogDescription>
      </DialogHeader>
      <DialogBody>
        <div className="signal-link-filters">
          <Field label="Buscar"><input value={query} onChange={event => onQueryChange(event.target.value)} placeholder="Nome, host, Agent ou estado" autoFocus /></Field>
          <Field label="Papel ao vincular"><select value={role} onChange={event => onRoleChange(event.target.value as typeof signalInfraRoles[number])}>{signalInfraRoles.map(item => <option key={item} value={item}>{roleLabels[item] ?? item}</option>)}</select></Field>
        </div>
        {error && <p role="alert" className="admin-error">{error}</p>}
        {atLimit && <p className="admin-muted">Limite de 20 vínculos atingido.</p>}
        {vms.length ? <ul className="signal-vm-list signal-link-modal-list">{vms.map(vm => <li key={`${vm.parentHostKey}:${vm.vmKey}`}>
          <div>
            <strong>{vm.name}</strong>
            <span className="app-monitor-meta">{vm.parentHostKey} · {vm.vmKey} · Agent {vm.linuxHostKey} · {vm.state}</span>
          </div>
          <Button type="button" onClick={() => void onLink(vm)} disabled={busy || atLimit}>Vincular</Button>
        </li>)}</ul> : <p className="panel-empty">{query.trim() ? "Nenhuma VM corresponde à busca." : "Todas as VMs com Agent já estão vinculadas, ou o inventário está vazio."}</p>}
      </DialogBody>
    </DialogContent>
  </Dialog>;
}

function MetricCard({ title, rows }: { title: string; rows: [string, string | number][] }) {
  return <article className="signal-metric-card"><h3>{title}</h3><dl>{rows.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl></article>;
}

type Draft = {
  displayName: string; description: string; baseUrl: string; enabled: boolean; dashboardEnabled: boolean;
  critical: boolean; displayOrder: number; timeoutSeconds: number;
};

function SignalEditForm({ existing, onSaved, onCancel }: {
  existing: Target | null; onSaved: () => Promise<void>; onCancel: () => void;
}) {
  const form = useForm<Draft>({
    defaultValues: existing ? {
      displayName: existing.displayName, description: existing.description ?? "", baseUrl: existing.baseUrl,
      enabled: existing.enabled, dashboardEnabled: existing.dashboardEnabled, critical: existing.critical,
      displayOrder: existing.displayOrder, timeoutSeconds: Math.round(existing.timeoutMs / 1000),
    } : {
      displayName: "Softcom Signal", description: "", baseUrl: "", enabled: true, dashboardEnabled: true,
      critical: false, displayOrder: 0, timeoutSeconds: 5,
    },
  });
  const mutation = useMutation();
  const [error, setError] = useState("");
  const submit = form.handleSubmit(async draft => {
    setError("");
    const input = {
      displayName: draft.displayName, description: draft.description.trim() || null, baseUrl: draft.baseUrl.trim(),
      enabled: draft.enabled, dashboardEnabled: draft.dashboardEnabled, critical: draft.critical,
      displayOrder: draft.displayOrder, timeoutMs: Math.round(draft.timeoutSeconds * 1000),
    };
    const parsed = signalTargetWriteSchema.safeParse(input);
    if (!parsed.success) { setError("Revise os campos. A URL precisa ser HTTPS (http só em hosts locais)."); return; }
    try {
      await mutation.run(async signal => existing
        ? api.patch(`/monitoring/signal-targets/${existing.id}`, { ...parsed.data, expectedRevision: existing.revision }, { signal })
        : api.post("/monitoring/signal-targets", parsed.data, { signal }));
      toast.success(existing ? "Signal atualizado." : "Signal cadastrado.");
      await onSaved();
    } catch (failure) {
      setError(isAxiosError(failure) && failure.response?.data?.error?.code === "revision_conflict"
        ? "Outra edição ganhou. Recarregue e tente de novo."
        : errorText(failure));
    }
  });
  return <form onSubmit={submit} className="admin-form signal-edit-form">
    <p className="admin-muted">Um serviço Softcom Signal. O intervalo fica no ambiente; o tempo limite é deste alvo.</p>
    <fieldset disabled={mutation.busy}><div className="admin-fields">
      <Field label="Nome"><input maxLength={120} {...form.register("displayName")} /></Field>
      <Field label="Descrição"><input maxLength={240} {...form.register("description")} /></Field>
      <Field label="URL base"><input maxLength={2048} {...form.register("baseUrl")} placeholder="https://api-signal.exemplo.cloud" /></Field>
      <Field label="Tempo limite (s)"><input type="number" min={1} max={15} {...form.register("timeoutSeconds", { valueAsNumber: true })} /></Field>
    </div><div className="admin-checks">
      <Check label="Habilitado"><input type="checkbox" {...form.register("enabled")} /></Check>
      <Check label="Destacar no dashboard"><input type="checkbox" {...form.register("dashboardEnabled")} /></Check>
      <Check label="Crítico"><input type="checkbox" {...form.register("critical")} /></Check>
    </div></fieldset>
    {error && <p role="alert" className="admin-error">{error}</p>}
    <div className="admin-actions">
      <Button type="submit" variant="primary" disabled={mutation.busy}>{mutation.busy ? "Salvando…" : "Salvar"}</Button>
      <Button type="button" onClick={onCancel}>Cancelar</Button>
    </div>
  </form>;
}
