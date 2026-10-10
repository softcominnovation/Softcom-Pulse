"use client";

import { PlaceLink } from "@/components/layout/place-link";
import { ArrowRight, Activity } from "lucide-react";
import type { CSSProperties } from "react";
import type { OptionsByType } from "@/lib/config/presentation";
import { number } from "@/lib/dashboard/format";
import { signalStateColor, signalStateLabel, signalStateTone, signalWorkersLabel } from "@/lib/signal/labels";
import { ProbeStrip } from "./probe-strip";
import "./signal-flow.css";

export type SignalFlowPayload = {
  target: {
    id: string;
    displayName: string;
    description: string | null;
    state: number;
    latencyMs: number | null;
    readyStatus: string | null;
    workerStatus: string | null;
    activeInstances: number | null;
    strip: number[];
    checkedAt: string | null;
    outboxPending: number | null;
    inboxPending: number | null;
    outboxDead: number | null;
    inboxDead: number | null;
    oldestOutboxSeconds: number | null;
    oldestInboxSeconds: number | null;
    checks: Record<string, unknown> | null;
  } | null;
};

type JobCounts = { queued: number | null; running: number | null; pending: number | null };
type PipelineRow = { id: string; tone: "good" | "warn" | "bad" | "unknown"; text: string; value: string };

function knowledgeJobs(checks: Record<string, unknown> | null): JobCounts {
  const knowledge = checks?.knowledgeIndex;
  if (!knowledge || typeof knowledge !== "object" || Array.isArray(knowledge)) {
    return { queued: null, running: null, pending: null };
  }
  const row = knowledge as Record<string, unknown>;
  const asCount = (value: unknown) => typeof value === "number" && Number.isFinite(value) ? value : null;
  return {
    queued: asCount(row.jobsQueued),
    running: asCount(row.jobsRunning),
    pending: asCount(row.itemsPending),
  };
}

function pipelineRows(target: NonNullable<SignalFlowPayload["target"]>): PipelineRow[] {
  const outbox = target.outboxPending;
  const inbox = target.inboxPending;
  const dead = (target.outboxDead ?? 0) + (target.inboxDead ?? 0);
  const hasDead = dead > 0;
  return [
    {
      id: "outbox",
      tone: outbox == null ? "unknown" : outbox > 0 ? "warn" : "good",
      text: "Saída · outbox na fila",
      value: outbox == null ? "—" : number(outbox),
    },
    {
      id: "inbox",
      tone: inbox == null ? "unknown" : inbox > 0 ? "warn" : "good",
      text: "Entrada · inbox na fila",
      value: inbox == null ? "—" : number(inbox),
    },
    {
      id: "dead",
      tone: target.outboxDead == null && target.inboxDead == null ? "unknown" : hasDead ? "warn" : "good",
      text: "Dead letter",
      value: target.outboxDead == null && target.inboxDead == null ? "—" : number(dead),
    },
  ];
}

function JobStat({ label, value }: { label: string; value: number | null }) {
  return <div className="signal-flow-job">
    <strong>{value == null ? "—" : number(value)}</strong>
    <span>{label}</span>
  </div>;
}

export function SignalFlowPanel({ data, options }: { data: SignalFlowPayload; options: OptionsByType["signal_flow"] }) {
  const target = data.target;
  if (!target) {
    return <section className="dashboard-panel signal-flow-panel" id="signal-flow">
      <div className="panel-heading"><Activity aria-hidden="true" /><h2>Signal · fluxo de processamento</h2></div>
      <p className="panel-empty">Nenhum alvo Softcom Signal habilitado. Cadastre em Serviços ou defina SIGNAL_API_BASE_URL.</p>
    </section>;
  }
  const tone = signalStateTone(target.state);
  const jobs = knowledgeJobs(target.checks);
  const rows = pipelineRows(target).slice(0, Math.min(3, options.visibleRows));
  const meta = [
    signalWorkersLabel(target.activeInstances, target.checkedAt),
    target.latencyMs !== null ? `${target.latencyMs} ms` : null,
  ].filter(Boolean).join(" · ");

  return <section className="dashboard-panel signal-flow-panel traffic-panel" id="signal-flow" style={{ "--visible-rows": options.visibleRows } as CSSProperties}>
    <div className="panel-heading">
      <Activity aria-hidden="true" />
      <h2>Signal · fluxo de processamento</h2>
      <PlaceLink className="panel-link" href="/servicos#signal">Ver métricas<ArrowRight aria-hidden="true" /></PlaceLink>
    </div>
    <div className="signal-flow-body">
      <div className="signal-flow-top">
        <span className={`availability-state tone-${tone}`}><i className="status-dot" />{signalStateLabel(target.state)}</span>
        <div className="signal-flow-jobs" aria-label="Jobs do índice de conhecimento">
          <JobStat label="Em fila" value={jobs.queued} />
          <JobStat label="Rodando" value={jobs.running} />
          <JobStat label="Pendentes" value={jobs.pending} />
        </div>
        {meta && <p className="signal-flow-meta">{meta}</p>}
      </div>
      <div className="signal-flow-uptime" role="img" aria-label="Disponibilidade recente do Signal">
        <ProbeStrip reasons={target.strip} variant="track" colorFor={signalStateColor} />
      </div>
      <ul className="signal-flow-events" aria-label="Filas do pipeline">
        {rows.map(row => <li key={row.id} className={`tone-${row.tone}`}>
          <i className="status-dot" />
          <span>{row.text}</span>
          <strong>{row.value}</strong>
        </li>)}
      </ul>
    </div>
    <footer className="panel-foot signal-flow-foot">
      <p>{target.displayName}</p>
      <p>{hasDeadLetter(target) ? "Dead letter com mensagens" : "Filas sob observação"}</p>
    </footer>
  </section>;
}

function hasDeadLetter(target: NonNullable<SignalFlowPayload["target"]>) {
  return (target.outboxDead ?? 0) > 0 || (target.inboxDead ?? 0) > 0;
}
