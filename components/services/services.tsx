"use client";

import { Activity, Box } from "lucide-react";
import { EvidenceClock, ReadNotice, useProblems } from "@/components/infrastructure/data";
import { ProblemsPanel } from "@/components/infrastructure/problems-panel";
import { ResourceCard } from "@/components/dashboard/resource-card";
import { useContainers, useServices } from "./data";
import { ContainerInventory } from "./container-inventory";
import { SignalServicesPanel } from "./signal-services";

export function Services() {
  return <EvidenceClock><ServicesContent /></EvidenceClock>;
}
function ServicesContent() {
  const inventory = useContainers(), services = useServices(), problems = useProblems();
  return <div className="infrastructure-details services-page"><div className="dashboard-heading"><div><h1>Cada serviço, acompanhado de perto.</h1><p className="dashboard-subtitle">Signal, containers, recursos configurados e problemas atuais.</p></div></div>
    <SignalServicesPanel />
    <ReadNotice result={inventory.data} failed={inventory.failed} refresh={inventory.refresh} label="inventário de containers" />
    <section className="dashboard-panel"><div className="panel-heading"><Box aria-hidden="true" /><h2>Inventário de containers</h2></div>{inventory.data ? <ContainerInventory containers={inventory.data.data} stale={inventory.failed || inventory.data.stale} availability={inventory.data.availability} /> : <p className="panel-empty">{inventory.failed ? "Inventário indisponível. Tente atualizar." : "Carregando containers…"}</p>}</section>
    <section className="dashboard-panel"><div className="panel-heading"><Activity aria-hidden="true" /><h2>Recursos configurados</h2></div><ReadNotice result={services.data} failed={services.failed} refresh={services.refresh} label="serviços configurados" />{services.data?.data.length ? <div className="resource-grid">{services.data.data.map(item => <ResourceCard key={item.id} item={item} stale={services.failed || !!services.data?.stale} compact />)}</div> : <p className="panel-empty">{services.loading ? "Carregando configurações…" : services.failed ? "Configurações indisponíveis nesta leitura." : "Nenhum recurso configurado no Pulse. Containers descobertos aparecem no inventário independentemente de cadastro."}</p>}</section>
    <ProblemsPanel poll={problems} title="Problemas ativos" />
  </div>;
}
