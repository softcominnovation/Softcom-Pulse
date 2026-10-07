"use client";

import { displayName } from "@/lib/monitoring/display-names";

import { Server } from "lucide-react";
import { useState } from "react";
import { EvidenceClock, ReadNotice, useHosts, useProblems } from "./data";
import { HostInventory, VmTable } from "./host-panels";
import { ProblemsPanel } from "./problems-panel";

export function Infrastructure() {
  const hosts = useHosts(), problems = useProblems();
  const [filter, setFilter] = useState("");
  const result = hosts.data, visible = result?.data.filter(host => !filter || host.hostKey === filter) ?? [];
  const stale = hosts.failed || !!result?.stale;
  return <EvidenceClock><div className="infrastructure-details">
    <div className="dashboard-heading"><div><h1>Infraestrutura</h1><p className="dashboard-subtitle">Hosts e VMs do escopo monitorado · evidências do Zabbix.</p></div><label className="resource-select-label" htmlFor="host-filter">Filtrar host<select id="host-filter" value={filter} onChange={event => setFilter(event.target.value)}><option value="">Todos os hosts</option>{result?.data.map(host => <option key={host.hostKey} value={host.hostKey}>{displayName(host)}</option>)}</select></label></div>
    <ReadNotice result={result} failed={hosts.failed} refresh={hosts.refresh} label="infraestrutura" />
    {result && <><HostInventory hosts={visible} stale={stale} />{visible.filter(host => host.role === "hypervisor").map(host => <section className="dashboard-panel vm-detail-panel" key={host.hostKey}><div className="panel-heading"><Server aria-hidden="true" /><h2>VMs de {displayName(host)}</h2></div><VmTable vms={host.vms} hosts={result.data} stale={stale} detailed /></section>)}<ProblemsPanel poll={problems} hostKeys={visible.map(host => host.hostKey)} /></>}
  </div></EvidenceClock>;
}
