"use client";

import Link from "next/link";
import { useState } from "react";
import type { Host, Container } from "@/lib/monitoring/contracts";
import type { ResourceConfig } from "@/lib/config/resources";
import { resourceSelectionSchema } from "@/lib/config/resource-context";
import { resolveResource } from "@/lib/monitoring/selectors";
import { asgardUrl } from "@/lib/infrastructure/navigation";
import { ResourceForm, resourceDefaults } from "./resource-form";

export function ResourceContextEditor({ selection, configs, failed, hosts, containers, ready, refresh }: {
  selection: Record<string, string | string[] | undefined>; configs: ResourceConfig[] | null; failed: boolean; hosts: Host[]; containers: Container[]; ready: boolean; refresh: () => void;
}) {
  const [closed, setClosed] = useState(false), parsed = resourceSelectionSchema.safeParse(selection);
  if (!parsed.success) return <p className="admin-error" role="alert">Contexto inválido. Selecione novamente o recurso no inventário.</p>;
  const value = parsed.data;
  if (!value.resourceId && !value.containerReference) return null;
  const returnUrl = value.parentHostKey && value.vmKey ? asgardUrl(value.parentHostKey, value.vmKey, value.range) : value.hostKey ? `/hosts/${encodeURIComponent(value.hostKey)}?range=${value.range}` : "/servicos";
  const back = <Link className="details-back" href={returnUrl}>Voltar ao contexto do recurso</Link>;
  if (closed) return <div className="admin-notice">{back}<Link href="/admin/configuracoes">Configurar blocos de serviços destacados</Link></div>;
  if (failed) return <p className="admin-error" role="alert">Não foi possível carregar a configuração selecionada. Use Recarregar recursos para tentar novamente. {back}</p>;
  if (!configs) return <p role="status">Carregando configuração selecionada…</p>;
  const target = containers.find(item => item.hostKey === value.hostKey && item.reference === value.containerReference);
  const candidates = target ? configs.filter(config => { const result = resolveResource(config, { hosts, containers }); return result.resolved && "reference" in result.target && result.target.reference === target.reference && result.target.hostKey === target.hostKey; }) : [];
  const existing = value.resourceId ? configs.find(config => config.id === value.resourceId) : candidates.length === 1 ? candidates[0] : undefined;
  const context = value.parentHostKey && value.vmKey && value.containerReference ? { parentHostKey: value.parentHostKey, vmKey: value.vmKey, containerReference: value.containerReference } : undefined;
  const linked = context ? hosts.find(host => host.hostKey === context.parentHostKey)?.vms.find(vm => vm.vmKey === context.vmKey && vm.linuxHostKey === value.hostKey) : undefined;
  const invalid = value.resourceId && !existing || !existing && !target || context && (!linked || !target || existing && (existing.resourceType !== "docker_container" || existing.zabbixHostKey !== value.hostKey));
  if (invalid) return <div className="admin-notice" role="alert">O alvo ou vínculo não está disponível nesta leitura. Atualize o inventário ou volte à VM. {back}</div>;
  if (!value.resourceId && candidates.length > 1) return <div className="admin-notice"><p>Há várias configurações para este container. Escolha qual editar.</p>{candidates.map(config => <p key={config.id}><Link href={`/admin/recursos?${new URLSearchParams({ ...Object.fromEntries(Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === "string")), resourceId: config.id })}`}>{config.displayName ?? config.selectorValue} · {config.enabled ? config.dashboardEnabled ? "Em destaque" : "Sem destaque" : "Desabilitado"}</Link></p>)}{back}</div>;
  return <section aria-label="Recurso selecionado"><p className="admin-notice">Nome e destaque são independentes. Para aparecer no dashboard, habilite Serviços destacados na tela e confira o filtro de críticos. <Link href="/admin/configuracoes">Ver configurações</Link></p>{back}<ResourceForm key={existing?.id ?? `${value.hostKey}:${value.containerReference}`} initial={existing ?? resourceDefaults(target!)} existing={existing} hosts={hosts} containers={containers} stale={!ready} context={context} onCancel={() => setClosed(true)} onSaved={() => { refresh(); setClosed(true); }} /></section>;
}
