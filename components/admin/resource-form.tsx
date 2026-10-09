"use client";

import { useForm, useWatch, type FieldPath } from "react-hook-form";
import { useState } from "react";
import { toast } from "sonner";
import { api } from "@/lib/client/api";
import type { ResourceContext } from "@/lib/config/resource-context";
import { resourceInputSchema, resourceConfigSchema, type ResourceInput, type ResourceConfig } from "@/lib/config/resources";
import type { Host, Container } from "@/lib/monitoring/contracts";
import { compileSelector, resolveResource } from "@/lib/monitoring/selectors";
import { ServiceAvailabilityCard } from "@/components/dashboard/service-availability-card";
import "@/components/dashboard/availability.css";
import { hostMetricsPreference, mergeCardCpuRam, resolveCardCpuRam } from "@/lib/monitoring/card-metrics";
import { Button } from "@/components/ui/button";
import { Check, Field, errorText, useMutation } from "./shared";

export function resourceDefaults(target: Host | Container): ResourceInput {
  const container = "reference" in target;
  const prefix = container ? target.name.replace(/\.\d+\.[a-z0-9]+$/i, "") : "";
  return resourceInputSchema.parse({ resourceType: container ? "docker_container" : "host", zabbixHostKey: target.hostKey,
    selectorType: container ? prefix !== target.name ? "name_prefix" : "exact_name" : null, selectorValue: container ? prefix : null, dashboardEnabled: true });
}
export function ResourceForm({ initial, existing, hosts, containers, stale, onSaved, onCancel, context }: {
  initial: ResourceInput; existing?: ResourceConfig; context?: ResourceContext; hosts: Host[]; containers: Container[]; stale: boolean; onSaved: () => void; onCancel: () => void;
}) {
  const defaults = resourceInputSchema.parse(Object.fromEntries(Object.entries(initial).filter(([key]) => !["id", "createdAt", "updatedAt"].includes(key))));
  const form = useForm<ResourceInput>({ defaultValues: defaults }), value = useWatch({ control: form.control }) as ResourceInput, mutation = useMutation();
  const [error, setError] = useState("");
  const isContainer = value.resourceType === "docker_container";
  let candidates: Container[] = [], invalidSelector = false;
  try { if (isContainer && value.selectorType && value.selectorValue) { const match = compileSelector(value.selectorType, value.selectorValue); candidates = containers.filter(item => item.hostKey === value.zabbixHostKey && match(item.name)); } }
  catch { invalidSelector = true; }
  const parsed = resourceInputSchema.safeParse(value);
  const resolution = parsed.success ? resolveResource(parsed.data, { hosts, containers }) : null;
  const ambiguous = isContainer && candidates.length > 1;
  const changedSelector = !existing || value.selectorType !== existing.selectorType || value.selectorValue !== existing.selectorValue;
  const flags = [["showStatus", "Estado"], ["showCpu", "CPU"], ["showMemory", "Memória"], ["showDisk", "Disco"], ["showNetwork", "Rede"], ["showUptime", "Tempo ativo"], ...(isContainer ? [["showHealth", "Healthcheck"], ["showHealthTimeline", "Histórico de healthcheck"]] : [])] as const;
  const submit = form.handleSubmit(async input => {
    setError(""); form.clearErrors();
    const validation = resourceInputSchema.safeParse(input);
    if (!validation.success) { for (const issue of validation.error.issues) form.setError(issue.path.join(".") as FieldPath<ResourceInput>, { message: "Confira este campo e o limite informado." }); setError("Revise os campos. Nome: até 120 caracteres; ordem: inteiro positivo; histórico de healthcheck exige healthcheck visível."); return; }
    try {
      const result = await mutation.run(async signal => {
        const response = existing ? await api.patch(`/monitoring/services/${existing.id}`, { ...validation.data, ...(context ? { context } : {}) }, { signal }) : await api.post("/monitoring/services", { ...validation.data, ...(context ? { context } : {}) }, { signal });
        return resourceConfigSchema.parse(response.data.data);
      });
      if (result) { window.dispatchEvent(new Event("pulse:preferences-changed")); toast.success("Configuração do recurso salva."); onSaved(); }
    } catch (failure) { setError(errorText(failure)); }
  });
  return <section className="dashboard-panel admin-editor" aria-label="Configuração do recurso"><div className="panel-heading"><h2>{existing ? "Editar recurso" : "Configurar recurso"}</h2></div>
    <form onSubmit={submit} className="admin-form"><p className="admin-muted">O nome pode ser salvo sem destaque. A exibição depende dos blocos e filtros da tela do dashboard.</p><p className="admin-muted">{isContainer ? "Container" : "Host"} · {value.zabbixHostKey}</p>
      <fieldset disabled={mutation.busy}><div className="admin-fields">
        <Field label="Nome amigável" error={form.formState.errors.displayName?.message}><input maxLength={120} value={value.displayName ?? ""} onChange={event => form.setValue("displayName", event.target.value || null, { shouldDirty: true })} placeholder="Usar nome descoberto" /></Field>
        <Field label="Descrição do serviço" hint="Texto curto apresentado abaixo do nome no dashboard."><input maxLength={240} value={value.description ?? ""} onChange={event => form.setValue("description", event.target.value || null, { shouldDirty: true })} placeholder="Ex.: Portal de atendimento" /></Field>
        <Field label="Tipo do serviço" hint="Classificação de exibição; não altera a origem da coleta."><input maxLength={40} value={value.serviceType ?? ""} onChange={event => form.setValue("serviceType", event.target.value || null, { shouldDirty: true })} placeholder="Ex.: API, Front, Worker, Banco" /></Field>
        <Field label="Ordem de exibição" error={form.formState.errors.displayOrder?.message}><input type="number" min={0} max={2147483647} {...form.register("displayOrder", { valueAsNumber: true })} /></Field>
        {isContainer && <><Field label="Correspondência do nome"><select {...form.register("selectorType")}><option value="exact_name">Nome exato</option><option value="name_prefix">Prefixo lógico (Swarm)</option><option value="name_contains">Contém</option><option value="regex">Expressão regular</option></select></Field><Field label="Seletor" error={invalidSelector ? "Expressão inválida ou não suportada." : ambiguous ? "Mais de um candidato. Ajuste o seletor." : undefined}><input maxLength={256} {...form.register("selectorValue")} /></Field></>}
      </div><div className="admin-checks">{([['enabled', 'Configuração habilitada'], ['dashboardEnabled', 'Destacar no dashboard'], ['critical', 'Recurso crítico']] as const).map(([key, label]) => <Check key={key} label={label}><input type="checkbox" {...form.register(key)} /></Check>)}</div>
      {existing && (!value.enabled || !value.dashboardEnabled) && <p className="admin-notice">Blocos individuais vinculados ficarão indisponíveis, preservando a escolha nas telas.</p>}
      <h3>Conteúdo do card</h3><div className="admin-checks">{flags.map(([key, label]) => <Check key={key} label={label}><input type="checkbox" {...form.register(`presentation.${key}` as keyof ResourceInput)} /></Check>)}</div>
      {!isContainer && <Field label="CPU e RAM do card" hint="Padrão: mesma fonte da listagem de VMs. Agent só se quiser mudar."><select value={((value.presentation as { metricsSource?: string } | undefined)?.metricsSource === "agent" ? "agent" : "hypervisor")} onChange={event => form.setValue("presentation.metricsSource", event.target.value as "agent" | "hypervisor", { shouldDirty: true, shouldTouch: true })}><option value="hypervisor">Listagem de VMs (Asgard / hipervisor) — padrão</option><option value="agent">Agent Zabbix (convidado Linux)</option></select></Field>}
      {isContainer && <Field label="Janela do histórico de healthcheck" hint="O histórico é consultado sob demanda no detalhe."><select {...form.register("presentation.healthTimelineRange")}><option value="1h">1 hora</option><option value="24h">24 horas</option><option value="7d">7 dias</option></select></Field>}
      </fieldset>
      {isContainer && <div className="admin-candidates"><strong>{candidates.length} candidato(s) na última leitura</strong>{stale && <p>Descoberta indisponível ou desatualizada; não confirma o vínculo atual.</p>}<ul>{candidates.map(item => <li key={item.reference}>{item.name}</li>)}</ul>{!candidates.length && <p>Nenhum container corresponde ao seletor nesta leitura. A configuração existente será preservada.</p>}</div>}
      {error && <p role="alert" className="admin-error">{error}</p>}
      <div className="admin-actions"><Button type="submit" variant="primary" disabled={mutation.busy || ambiguous && changedSelector || invalidSelector || !existing && stale}>{mutation.busy ? "Salvando…" : "Salvar recurso"}</Button><Button type="button" disabled={mutation.busy} onClick={onCancel}>Cancelar</Button></div>
    </form>
    {parsed.success && resolution && (() => {
      const target = resolution.target;
      const baseMetrics = target?.metrics ?? {};
      const preferred = target && !("reference" in target)
        ? resolveCardCpuRam(target, hosts, hostMetricsPreference(parsed.data.presentation)).metrics
        : {};
      const metrics = mergeCardCpuRam(baseMetrics, preferred);
      return <div className="admin-resource-preview"><h3>Prévia local · não salva</h3><ServiceAvailabilityCard preview stale={stale} item={{ id: existing?.id ?? "00000000-0000-4000-8000-000000000000", config: { ...parsed.data, id: existing?.id ?? "00000000-0000-4000-8000-000000000000", createdAt: existing?.createdAt ?? new Date(0).toISOString(), updatedAt: existing?.updatedAt ?? new Date(0).toISOString() }, resolved: resolution.resolved, resolution: resolution.resolution, resource: resolution.target, metrics }} /></div>;
    })()}
  </section>;
}
