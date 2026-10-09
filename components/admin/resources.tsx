"use client";

import { useContext, useMemo, useRef, useState } from "react";
import { z } from "zod";
import { toast } from "sonner";
import { api } from "@/lib/client/api";
import { resourceConfigSchema, type ResourceConfig, type ResourceInput } from "@/lib/config/resources";
import { resolveResource } from "@/lib/monitoring/selectors";
import type { Host, Container } from "@/lib/monitoring/contracts";
import { useHosts, EvidenceClock } from "@/components/infrastructure/data";
import { useContainers } from "@/components/services/data";
import { EvidenceTimeContext, Status } from "@/components/dashboard/metrics";
import { Button } from "@/components/ui/button";
import { ConfirmationDialog } from "@/components/confirmation-dialog";
import { ReadError, useAdminRead } from "./shared";
import Link from "next/link";
import { ResourceContextEditor } from "./resource-context";
import { displayName } from "@/lib/monitoring/display-names";
import { useCanEdit } from "@/store/auth.store";
import { ResourceForm, resourceDefaults } from "./resource-form";
import { ScopeSection } from "./scope";

type InventoryTarget = Host | Container;
type KindFilter = "all" | "host" | "container";
type StateFilter = "" | "reachable" | "unreachable" | "running" | "stopped" | "paused" | "unknown" | "stale";

const stateFilterOptions: { value: StateFilter; label: string }[] = [
  { value: "", label: "Todos os estados" },
  { value: "reachable", label: "Disponível" },
  { value: "unreachable", label: "Indisponível" },
  { value: "running", label: "Em execução" },
  { value: "stopped", label: "Parado" },
  { value: "paused", label: "Pausado" },
  { value: "unknown", label: "Desconhecido" },
  { value: "stale", label: "Desatualizado" },
];

export const parseResources = (data: unknown) => z.object({ data: resourceConfigSchema.array() }).parse(data).data;
function ResourceResolution({ config, hosts, containers, stale }: { config: ResourceConfig; hosts: Host[]; containers: Container[]; stale: boolean }) {
  const result = resolveResource(config, { hosts, containers });
  return <p>{stale ? "Associação sem evidência atual" : result.resolution === "ambiguous" ? "Mais de um candidato · ajuste o seletor" : result.resolution === "missing" ? "Recurso não encontrado na descoberta atual" : "Recurso identificado na descoberta"}</p>;
}
function isContainerTarget(target: InventoryTarget): target is Container {
  return "reference" in target;
}
export function ResourcesAdmin({ selection = {} }: { selection?: Record<string, string | string[] | undefined> }) { return <EvidenceClock><ResourcesContent selection={selection} /></EvidenceClock>; }
function ResourcesContent({ selection }: { selection: Record<string, string | string[] | undefined> }) {
  const now = useContext(EvidenceTimeContext), canEdit = useCanEdit();
  const configs = useAdminRead("/settings/resources", parseResources), hosts = useHosts(), containers = useContainers();
  const hostsData = hosts.data, hostsFailed = hosts.failed, containersData = containers.data, containersFailed = containers.failed;
  const [form, setForm] = useState<{ initial: ResourceInput; existing?: ResourceConfig; key: number } | null>(null);
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState<KindFilter>("all");
  const [state, setState] = useState<StateFilter>("");
  const editorRef = useRef<HTMLDivElement>(null), listRef = useRef<HTMLHeadingElement>(null);
  const [sequence, setSequence] = useState(0);
  const current = (result: typeof hostsData | typeof containersData, failed: boolean) => !!result && !failed && !result.stale && result.availability === "ready";
  const select = (initial: ResourceInput, existing?: ResourceConfig) => { setSequence(sequence + 1); setForm({ initial, existing, key: sequence }); setTimeout(() => editorRef.current?.querySelector<HTMLInputElement>("input")?.focus(), 0); };
  const close = () => { setForm(null); listRef.current?.focus(); };
  const targetReady = (target: InventoryTarget) => {
    const isContainer = isContainerTarget(target);
    return current(isContainer ? containersData : hostsData, isContainer ? containersFailed : hostsFailed)
      && !!target.evidence.observedAt
      && (target.evidence.validUntil === undefined || !!target.evidence.validUntil && Date.parse(target.evidence.validUntil) > now);
  };
  const targets = useMemo(() => [...(hostsData?.data ?? []), ...(containersData?.data ?? [])] as InventoryTarget[], [hostsData, containersData]);
  const visible = useMemo(() => {
    const needle = query.toLocaleLowerCase("pt-BR");
    const match = (value: string) => value.toLocaleLowerCase("pt-BR").includes(needle);
    const snapshotReady = (result: typeof hostsData | typeof containersData, failed: boolean) => !!result && !failed && !result.stale && result.availability === "ready";
    const ready = (target: InventoryTarget) => {
      const isContainer = isContainerTarget(target);
      return snapshotReady(isContainer ? containersData : hostsData, isContainer ? containersFailed : hostsFailed)
        && !!target.evidence.observedAt
        && (target.evidence.validUntil === undefined || !!target.evidence.validUntil && Date.parse(target.evidence.validUntil) > now);
    };
    const targetState = (target: InventoryTarget) => (ready(target) ? (isContainerTarget(target) ? target.status : target.availability) : "stale");
    return targets.filter(target => {
      if (kind === "host" && isContainerTarget(target)) return false;
      if (kind === "container" && !isContainerTarget(target)) return false;
      if (state && targetState(target) !== state) return false;
      return match(displayName(target) + " " + target.name + " " + target.hostKey);
    });
  }, [targets, kind, state, query, hostsData, hostsFailed, containersData, containersFailed, now]);
  return <EvidenceClock><div className="admin-page"><header className="admin-heading"><h1>Recursos em destaque</h1><p>Escolha o que acompanhar e o conteúdo de cada card.</p></header>
    {canEdit && <ResourceContextEditor key={JSON.stringify(selection)} selection={selection} failed={configs.failed} configs={configs.failed ? null : configs.data} hosts={hosts.data?.data ?? []} containers={containers.data?.data ?? []} ready={current(containers.data, containers.failed) && current(hosts.data, hosts.failed)} refresh={() => { configs.refresh(); hosts.refresh(); containers.refresh(); }} />}
    <section className="dashboard-panel"><div className="panel-heading"><h2>Inventário descoberto</h2><Button onClick={() => { hosts.refresh(); containers.refresh(); }}>Atualizar inventário</Button></div>
      <div className="admin-form"><div className="admin-fields">
        <label className="admin-field"><span>Buscar host ou container</span><input value={query} onChange={event => setQuery(event.target.value)} type="search" /></label>
        <label className="admin-field" htmlFor="inventory-kind-filter"><span>Tipo</span><select id="inventory-kind-filter" value={kind} onChange={event => setKind(event.target.value as KindFilter)}><option value="all">Todos</option><option value="host">Host</option><option value="container">Container</option></select></label>
        <label className="admin-field" htmlFor="inventory-state-filter"><span>Estado</span><select id="inventory-state-filter" value={state} onChange={event => setState(event.target.value as StateFilter)}>{stateFilterOptions.map(option => <option key={option.value || "all"} value={option.value}>{option.label}</option>)}</select></label>
      </div>
      {(hosts.failed || containers.failed || hosts.data?.stale || containers.data?.stale) && <p className="admin-notice" role="status">A descoberta está parcial ou desatualizada. Cadastre novos destaques somente após uma leitura atual. As configurações salvas continuam acessíveis abaixo.</p>}</div>
      <div className="admin-table-scroll" tabIndex={0} role="region" aria-label="Inventário disponível"><table className="admin-table"><thead><tr><th>Recurso</th><th>Host / tipo</th><th>Estado</th><th>Ação</th></tr></thead><tbody>{visible.map(target => {
        const isContainer = isContainerTarget(target), ready = targetReady(target);
        return <tr key={target.hostKey + (isContainer ? target.reference : ":host")}><th>{displayName(target)}{target.nameConflict && <small>Conflito de nomes: revise as configurações salvas.</small>}{target.presentationStatus === "unavailable" && <small>Personalização indisponível</small>}</th><td>{target.hostKey}<small>{isContainer ? "Container" : "Host"}</small></td><td><Status value={isContainer ? target.status : target.availability} stale={!ready} /></td><td>{canEdit && <Button onClick={() => { const matches = (configs.data ?? []).filter(config => { const result = resolveResource(config, { hosts: hosts.data?.data ?? [], containers: containers.data?.data ?? [] }); return result.resolved && result.target.hostKey === target.hostKey && ("reference" in target ? "reference" in result.target && result.target.reference === target.reference : !("reference" in result.target)); }); if (matches.length === 1) select(matches[0], matches[0]); else if (matches.length > 1) { setQuery(target.name); listRef.current?.focus(); toast.info("Há várias configurações. Escolha uma em Configurações salvas."); } else select(resourceDefaults(target)); }} disabled={!ready || configs.loading || configs.failed}>Configurar<span className="sr-only"> {target.name}</span></Button>}</td></tr>;
      })}</tbody></table>{!targets.length && <p className="panel-empty">{hosts.loading || containers.loading ? "Carregando inventário…" : "Nenhum recurso disponível nesta leitura."}</p>}{targets.length > 0 && !visible.length && <p className="panel-empty">Nenhum recurso corresponde aos filtros.</p>}</div>
    </section>
    <div ref={editorRef}>{canEdit && form && <ResourceForm key={form.key} initial={form.initial} existing={form.existing} hosts={hosts.data?.data ?? []} containers={containers.data?.data ?? []} stale={!current(form.initial.resourceType === "host" ? hosts.data : containers.data, form.initial.resourceType === "host" ? hosts.failed : containers.failed)} onCancel={close} onSaved={() => { configs.refresh(); hosts.refresh(); containers.refresh(); close(); }} />}</div>
    <section className="dashboard-panel"><div className="panel-heading"><h2 ref={listRef} tabIndex={-1}>Configurações salvas</h2>{canEdit && <Link href="/admin/configuracoes">Blocos e filtros do dashboard</Link>}<Button onClick={configs.refresh}>Recarregar recursos</Button></div>
      {configs.failed && <ReadError refresh={configs.refresh}>Não foi possível ler as configurações salvas.</ReadError>}
      {configs.loading && !configs.data && <p className="panel-empty">Carregando configurações…</p>}
      {configs.data?.length === 0 && <p className="panel-empty">Nenhum destaque configurado. Selecione um recurso no inventário acima.</p>}
      <ul className="admin-saved-list">{configs.data?.map(config => <li key={config.id}><div><strong>{config.displayName ?? config.selectorValue ?? config.zabbixHostKey}</strong><p>{config.zabbixHostKey} · {config.resourceType === "host" ? "Host" : "Container"} · {config.enabled ? config.dashboardEnabled ? "Em destaque" : "Sem destaque" : "Desabilitado"}{config.critical ? " · Crítico" : ""}</p><ResourceResolution config={config} hosts={hosts.data?.data ?? []} containers={containers.data?.data ?? []} stale={!current(config.resourceType === "host" ? hosts.data : containers.data, config.resourceType === "host" ? hosts.failed : containers.failed)} /></div>{canEdit && <div className="admin-actions"><Button onClick={() => select(config, config)}>Editar</Button><ConfirmationDialog trigger={<Button>Remover</Button>} title="Remover configuração de visualização?" description="A configuração e os blocos individuais vinculados serão retirados das telas do Pulse. O host ou container no Zabbix será preservado." confirmLabel="Remover configuração" destructive onConfirm={async () => { await api.delete(`/monitoring/services/${config.id}`); toast.success("Configuração removida."); if (form?.existing?.id === config.id) close(); configs.refresh(); listRef.current?.focus(); }} /></div>}</li>)}</ul>
    </section>
    <ScopeSection />
  </div></EvidenceClock>;
}
