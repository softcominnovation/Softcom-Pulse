"use client";

import { displayName } from "@/lib/monitoring/display-names";
import { filterAndSortVms, type VmSortBy, type VmStateFilter } from "@/lib/infrastructure/vm-list";

import { Server } from "lucide-react";
import { useContext, useMemo, useState } from "react";
import { EvidenceTimeContext } from "@/components/dashboard/metrics";
import { EvidenceClock, ReadNotice, useHosts, useProblems } from "./data";
import { HostInventory, VmTable } from "./host-panels";
import { ProblemsPanel } from "./problems-panel";

function VmListToolbar({
  query, state, sortBy, sortDirection, total, visible,
  onQuery, onState, onSortBy, onSortDirection,
}: {
  query: string; state: VmStateFilter; sortBy: VmSortBy; sortDirection: "asc" | "desc"; total: number; visible: number;
  onQuery: (value: string) => void; onState: (value: VmStateFilter) => void; onSortBy: (value: VmSortBy) => void; onSortDirection: (value: "asc" | "desc") => void;
}) {
  return <div className="vm-list-toolbar" role="search" aria-label="Filtros da listagem de VMs do Asgard">
    <label className="resource-select-label" htmlFor="vm-search">Buscar VM<input id="vm-search" type="search" value={query} onChange={event => onQuery(event.target.value)} placeholder="Nome no Zabbix ou no Pulse" autoComplete="off" /></label>
    <label className="resource-select-label" htmlFor="vm-state-filter">Estado<select id="vm-state-filter" value={state} onChange={event => onState(event.target.value as VmStateFilter)}><option value="">Todos os estados</option><option value="running">Em execução</option><option value="paused">Pausadas</option><option value="stopped">Paradas</option><option value="unknown">Sem estado atual</option></select></label>
    <label className="resource-select-label" htmlFor="vm-sort-by">Ordenar por<select id="vm-sort-by" value={sortBy} onChange={event => onSortBy(event.target.value as VmSortBy)}><option value="name">Nome</option><option value="cpu">Consumo de CPU</option><option value="memory">Consumo de RAM</option><option value="cpu_memory">CPU e RAM</option></select></label>
    <label className="resource-select-label" htmlFor="vm-sort-direction">Direção<select id="vm-sort-direction" value={sortDirection} onChange={event => onSortDirection(event.target.value as "asc" | "desc")}><option value="desc">Decrescente</option><option value="asc">Crescente</option></select></label>
    {(query || state || visible !== total) && <p className="vm-list-toolbar-count" role="status">{visible} de {total} VMs</p>}
  </div>;
}

function InfrastructureContent() {
  const hosts = useHosts(), problems = useProblems();
  const now = useContext(EvidenceTimeContext);
  const [filter, setFilter] = useState("");
  const [query, setQuery] = useState("");
  const [state, setState] = useState<VmStateFilter>("");
  const [sortBy, setSortBy] = useState<VmSortBy>("name");
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("asc");
  const result = hosts.data, visible = result?.data.filter(host => !filter || host.hostKey === filter) ?? [];
  const stale = hosts.failed || !!result?.stale;
  const hypervisors = useMemo(() => visible.filter(host => host.role === "hypervisor"), [visible]);
  const totalVms = useMemo(() => hypervisors.reduce((count, host) => count + host.vms.length, 0), [hypervisors]);
  const listed = useMemo(() => hypervisors.map(host => ({
    host,
    vms: filterAndSortVms(host.vms, { query, state, sortBy, sortDirection }, stale, now),
  })), [hypervisors, query, state, sortBy, sortDirection, stale, now]);
  const visibleVms = listed.reduce((count, item) => count + item.vms.length, 0);

  return <div className="infrastructure-details">
    <div className="dashboard-heading"><div><h1>Infraestrutura</h1><p className="dashboard-subtitle">Hosts e VMs do escopo monitorado · evidências do Zabbix.</p></div><label className="resource-select-label" htmlFor="host-filter">Filtrar host<select id="host-filter" value={filter} onChange={event => setFilter(event.target.value)}><option value="">Todos os hosts</option>{result?.data.map(host => <option key={host.hostKey} value={host.hostKey}>{displayName(host)}</option>)}</select></label></div>
    <ReadNotice result={result} failed={hosts.failed} refresh={hosts.refresh} label="infraestrutura" />
    {result && <>
      <HostInventory hosts={visible} stale={stale} />
      {hypervisors.length > 0 && <VmListToolbar query={query} state={state} sortBy={sortBy} sortDirection={sortDirection} total={totalVms} visible={visibleVms} onQuery={setQuery} onState={setState} onSortBy={value => { setSortBy(value); setSortDirection(value === "name" ? "asc" : "desc"); }} onSortDirection={setSortDirection} />}
      {listed.map(({ host, vms }) => <section className="dashboard-panel vm-detail-panel" key={host.hostKey}><div className="panel-heading"><Server aria-hidden="true" /><h2>VMs de {displayName(host)}</h2></div>{!vms.length && (query || state) ? <p className="panel-empty">Nenhuma VM corresponde à busca ou ao filtro de estado.</p> : <VmTable vms={vms} hosts={result.data} stale={stale} detailed />}</section>)}
      <ProblemsPanel poll={problems} hostKeys={visible.map(host => host.hostKey)} />
    </>}
  </div>;
}

export function Infrastructure() {
  return <EvidenceClock><InfrastructureContent /></EvidenceClock>;
}
