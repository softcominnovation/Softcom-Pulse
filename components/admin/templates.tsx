"use client";

import { useContext, useEffect, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { toast } from "sonner";
import { api } from "@/lib/client/api";
import { templateConfigSchema, templateWriteSchema, type TemplateConfig } from "@/lib/config/templates";
import { templateSchema, type Template } from "@/lib/monitoring/templates";
import { readSchema, useHosts } from "@/components/infrastructure/data";
import { EvidenceTimeContext, MetricValue } from "@/components/dashboard/metrics";
import { timestamp } from "@/lib/dashboard/format";
import { Button } from "@/components/ui/button";
import { ConfirmationDialog } from "@/components/confirmation-dialog";
import { Field, ReadError, errorText, useAdminRead, useMutation } from "./shared";

const parseConfigs = (data: unknown) => z.object({ data: templateConfigSchema.array() }).parse(data).data;
const parseTemplates = (data: unknown) => readSchema(templateSchema.array()).parse(data);
type Draft = { key: string; technicalName: string; config: TemplateConfig | null; canCreate: boolean };
function TemplateForm({ draft, done, reload }: { draft: Draft; done: () => void; reload: () => void }) {
  const form = useForm({ defaultValues: { displayName: draft.config?.displayName ?? "", role: draft.config?.roleOverride ?? "automatic" } });
  const [error, setError] = useState(""), mutation = useMutation();
  const write = async (reset = false) => {
    const values = form.getValues(), result = templateWriteSchema.safeParse({ expectedRevision: draft.config?.revision ?? 0, displayName: reset ? null : values.displayName.trim() || null, roleOverride: reset || values.role === "automatic" ? null : values.role });
    if (!result.success) { setError("Informe um nome de até 120 caracteres, sem caracteres de controle, e um papel válido."); return false; }
    const saved = await mutation.run(async signal => templateConfigSchema.parse((await api.put(`/settings/templates/${draft.key}`, result.data, { signal })).data.data));
    if (saved) { toast.success(reset ? "Convenção automática restaurada." : "Preferências do template salvas."); done(); }
    return !!saved;
  };
  return <form className="admin-form admin-template-form" onSubmit={form.handleSubmit(async () => { setError(""); try { await write(); } catch (failure) { setError(errorText(failure)); } })} aria-label={`Editar template ${draft.technicalName}`}>
    <h3>{draft.technicalName}</h3><p className="admin-muted">O nome técnico e as capacidades da origem serão preservados.</p>
    <fieldset disabled={mutation.busy}><div className="admin-fields"><Field label="Nome amigável" hint="Em branco usa o nome técnico."><input maxLength={120} {...form.register("displayName")} /></Field><Field label="Papel"><select {...form.register("role")}><option value="automatic">Automático pelo nome</option><option value="worker">Worker</option><option value="manager">Manager</option></select></Field></div></fieldset>
    {error && <p role="alert" className="admin-error">{error}</p>}
    {!draft.config && !draft.canCreate && <p className="admin-notice">Aguarde uma descoberta atual antes de salvar a primeira preferência.</p>}
    <div className="admin-actions"><Button type="submit" variant="primary" disabled={mutation.busy || !draft.config && !draft.canCreate}>{mutation.busy ? "Salvando…" : "Salvar template"}</Button><Button type="button" disabled={mutation.busy} onClick={done}>Cancelar</Button>
      <ConfirmationDialog trigger={<Button type="button" disabled={mutation.busy || !draft.config}>Restaurar automático</Button>} title="Restaurar identificação automática?" description="O nome amigável e o papel escolhido serão limpos. O Pulse usará o nome técnico e a convenção de Worker/Manager. O template no Proxmox será preservado." confirmLabel="Restaurar automático" onConfirm={async () => { try { await write(true); } catch (failure) { setError(errorText(failure)); throw failure; } }} />
      {error && <ConfirmationDialog trigger={<Button type="button">Recarregar para revisar</Button>} title="Recarregar preferência salva?" description="O rascunho deste template será descartado. Abra a edição novamente para revisar a versão salva." confirmLabel="Recarregar preferência" onConfirm={reload} />}
    </div>
  </form>;
}
export function TemplatesAdmin() {
  const now = useContext(EvidenceTimeContext);
  const hosts = useHosts(), configs = useAdminRead("/settings/templates", parseConfigs);
  const templates = useAdminRead(`/monitoring/templates${hosts.data?.asgardHostKey ? `?hostKey=${encodeURIComponent(hosts.data.asgardHostKey)}` : ""}`, parseTemplates);
  const [draft, setDraft] = useState<Draft | null>(null);
  const trigger = useRef<HTMLElement | null>(null), heading = useRef<HTMLHeadingElement>(null), restoreFocus = useRef(false);
  useEffect(() => { if (!draft && !configs.loading && !templates.loading && restoreFocus.current) { restoreFocus.current = false; (trigger.current?.isConnected ? trigger.current : heading.current)?.focus(); } }, [draft, configs.loading, templates.loading]);
  const saved = new Map(configs.data?.map(config => [config.templateKey, config]));
  const discovered = templates.data?.data ?? [], keys = new Set(discovered.map(item => item.templateKey));
  const stale = templates.failed || !templates.data || templates.data.stale || templates.data.availability !== "ready";
  const refresh = () => { templates.refresh(); configs.refresh(); };
  const done = () => { restoreFocus.current = true; setDraft(null); refresh(); };
  const items = discovered.map(item => { const config = saved.get(item.templateKey); return { ...item, config, displayName: config?.displayName ?? item.technicalName, role: config?.roleOverride ?? (item.technicalName.toLowerCase().includes("worker") ? "worker" : "manager") }; });
  const sort = (a: { displayName: string; templateKey: string }, b: { displayName: string; templateKey: string }) => a.displayName.localeCompare(b.displayName, "pt-BR", { sensitivity: "base" }) || a.templateKey.localeCompare(b.templateKey);
  const edit = (item: Template) => setDraft({ key: item.templateKey, technicalName: item.technicalName, config: saved.get(item.templateKey) ?? null, canCreate: !stale && !!item.evidence.observedAt && (item.evidence.validUntil === undefined || !!item.evidence.validUntil && Date.parse(item.evidence.validUntil) > now) });
  return <section className="dashboard-panel admin-templates"><div className="panel-heading"><h2 ref={heading} tabIndex={-1}>Templates do ASGARD</h2><Button onClick={refresh}>Atualizar templates</Button></div><div className="admin-form"><p>Defina nomes amigáveis e papéis de apresentação. A convenção automática usa Worker quando o nome técnico contém “worker”; nos demais casos, Manager. Isso não representa metadado de papel do Proxmox.</p>
    {configs.failed && <ReadError refresh={configs.refresh}>Não foi possível ler as preferências salvas. Aguarde a leitura antes de editar.</ReadError>}
    {stale && <ReadError refresh={templates.refresh}>A descoberta de templates está indisponível ou desatualizada. Preferências existentes podem ser editadas; novas preferências exigem descoberta atual.</ReadError>}
    {configs.loading && !configs.data && <p role="status">Carregando preferências…</p>}
    {draft && <TemplateForm key={draft.key} draft={draft} done={done} reload={done} />}
    {(["worker", "manager"] as const).map(role => <div key={role} className="admin-template-group"><h3>{role === "worker" ? "Workers" : "Managers"} · {items.filter(item => item.role === role).length}</h3><div className="admin-template-grid">{items.filter(item => item.role === role).sort(sort).map(item => <article key={item.templateKey} className="admin-template-card"><h4>{item.displayName}</h4>{item.displayName !== item.technicalName && <p>{item.technicalName}</p>}{!item.config && <p>Sem personalização</p>}<p>{item.hostKey} · ID {item.templateId ?? "indisponível"} · {item.virtualizationType ?? "tipo não informado"}</p><p>Papel: {item.config?.roleOverride ? "configurado no Pulse" : "convenção do nome"}</p><dl className="admin-capacities"><div><dt>vCPUs</dt><dd><MetricValue compact metric={item.virtualCpuCount ?? undefined} stale={stale} /></dd></div><div><dt>Memória</dt><dd><MetricValue compact metric={item.memoryBytes ?? undefined} stale={stale} /></dd></div><div><dt>Disco</dt><dd><MetricValue compact metric={item.diskBytes ?? undefined} stale={stale} /></dd></div></dl><p>SO / versão: {item.operatingSystem ?? "Não informado pela origem"}</p><p>Evidência: {timestamp(item.evidence.observedAt)}</p><Button disabled={!configs.data || configs.failed || !item.config && stale} onClick={event => { trigger.current = event.currentTarget; edit(item); }}>Editar template<span className="sr-only"> {item.technicalName}</span></Button></article>)}</div>{!items.some(item => item.role === role) && <p className="admin-muted">{stale ? "Sem descoberta atual para este grupo." : "Nenhum template neste grupo."}</p>}</div>)}
    {!!configs.data?.some(item => !keys.has(item.templateKey)) && <div className="admin-template-group"><h3>Preferências sem descoberta atual</h3><p className="admin-muted">Identidades preservadas; nenhum vínculo novo foi inferido.</p><ul className="admin-saved-list">{configs.data.filter(item => !keys.has(item.templateKey)).map(item => <li key={item.templateKey}><div><strong>{item.displayName ?? item.originalName}</strong><p>{item.originalName} · {item.hostKey} · ID {item.templateId} · {item.virtualizationType}</p></div><Button disabled={configs.failed} onClick={event => { trigger.current = event.currentTarget; setDraft({ key: item.templateKey, technicalName: item.originalName, config: item, canCreate: false }); }}>Editar preferência</Button></li>)}</ul></div>}
  </div></section>;
}
