"use client";

import { useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { toast } from "sonner";
import { api } from "@/lib/client/api";
import { vmConfigSchema, vmWriteSchema, type VmDisplayConfig } from "@/lib/config/vms";
import type { VirtualMachine } from "@/lib/monitoring/contracts";
import { displayName } from "@/lib/monitoring/display-names";
import { useHosts } from "@/components/infrastructure/data";
import { Button } from "@/components/ui/button";
import { ConfirmationDialog } from "@/components/confirmation-dialog";
import { Field, ReadError, errorText, useAdminRead, useMutation } from "./shared";
import "./admin.css";

const parseConfigs = (value: unknown) => z.object({ data: vmConfigSchema.array() }).parse(value).data;
type Draft = { key: string; name: string; config?: VmDisplayConfig; canCreate: boolean };
function VmNameForm({ draft, done }: { draft: Draft; done: () => void }) {
  const form = useForm({ defaultValues: { displayName: draft.config?.displayName ?? "" } });
  const mutation = useMutation(), [error, setError] = useState("");
  const write = async (reset = false) => {
    setError("");
    const input = vmWriteSchema.safeParse({ expectedRevision: draft.config?.revision ?? 0, displayName: reset ? null : form.getValues("displayName") });
    if (!input.success) { setError("Informe até 120 caracteres, sem caracteres de controle."); return; }
    try {
      const saved = await mutation.run(async signal => vmConfigSchema.parse((await api.put(`/settings/vms/${draft.key}`, input.data, { signal })).data.data));
      if (saved) { window.dispatchEvent(new Event("pulse:preferences-changed")); toast.success("Nome da VM salvo."); done(); }
    } catch (failure) { setError(errorText(failure)); }
  };
  return <form className="admin-form admin-template-form" aria-label={`Nome da VM ${draft.name}`} onSubmit={form.handleSubmit(() => write())}>
    <h3>{draft.name}</h3><p className="admin-muted">Nome de exibição no Pulse. A identidade técnica e o nome no Proxmox serão preservados.</p>
    <fieldset disabled={mutation.busy}><Field label="Nome amigável da VM" hint="Em branco usa o nome técnico atual."><input autoFocus maxLength={120} {...form.register("displayName")} /></Field></fieldset>
    {error && <p className="admin-error" role="alert">{error}</p>}
    {!draft.config && !draft.canCreate && <p className="admin-notice">Aguarde uma descoberta atual para criar a preferência.</p>}
    <div className="admin-actions"><Button type="submit" variant="primary" disabled={mutation.busy || !draft.config && !draft.canCreate}>Salvar nome</Button><Button type="button" disabled={mutation.busy} onClick={done}>Cancelar</Button>
      <ConfirmationDialog trigger={<Button type="button" disabled={mutation.busy || !draft.config}>Restaurar nome técnico</Button>} title="Restaurar nome técnico?" description="O nome amigável será limpo somente no Pulse. A VM será preservada." confirmLabel="Restaurar nome técnico" onConfirm={() => write(true)} />
      {error && <ConfirmationDialog trigger={<Button type="button">Recarregar para revisar</Button>} title="Recarregar preferência da VM?" description="O rascunho será descartado. Abra a edição novamente para revisar a versão salva." confirmLabel="Recarregar preferência" onConfirm={done} />}
    </div>
  </form>;
}
export function VmNameEditor({ vm, canCreate, onClose }: { vm: VirtualMachine; canCreate: boolean; onClose: () => void }) {
  const configs = useAdminRead("/settings/vms", parseConfigs);
  if (configs.failed) return <ReadError refresh={configs.refresh}>Não foi possível ler os nomes salvos.<Button onClick={onClose}>Cancelar</Button></ReadError>;
  if (!configs.data) return <p role="status">Carregando nome da VM…</p>;
  return <VmNameForm draft={{ key: vm.vmKey, name: vm.name, config: configs.data.find(item => item.vmKey === vm.vmKey), canCreate }} done={onClose} />;
}
export function VmsAdmin() {
  const hosts = useHosts(), configs = useAdminRead("/settings/vms", parseConfigs);
  const [query, setQuery] = useState(""), [parent, setParent] = useState(""), [draft, setDraft] = useState<Draft | null>(null);
  const trigger = useRef<HTMLButtonElement | null>(null), heading = useRef<HTMLHeadingElement>(null);
  const discovered = hosts.data?.data.flatMap(host => host.vms) ?? [], keys = new Set(discovered.map(vm => vm.vmKey));
  const saved = new Map(configs.data?.map(config => [config.vmKey, config]));
  const canCreate = !hosts.failed && !!hosts.data && !hosts.data.stale && hosts.data.availability === "ready";
  const rows = [
    ...discovered.map(vm => ({ key: vm.vmKey, name: vm.name, label: saved.get(vm.vmKey)?.displayName ?? displayName(vm), host: vm.parentHostKey, id: vm.vmId, agent: vm.linuxHostKey, orphan: false })),
    ...(configs.data ?? []).filter(config => !keys.has(config.vmKey)).map(config => ({ key: config.vmKey, name: config.originalName, label: config.displayName ?? config.originalName, host: config.hostKey, id: config.vmId, agent: null, orphan: true })),
  ].filter(row => (!parent || row.host === parent) && `${row.label} ${row.name} ${row.id}`.toLocaleLowerCase("pt-BR").includes(query.toLocaleLowerCase("pt-BR"))).sort((a, b) => a.label.localeCompare(b.label, "pt-BR") || a.key.localeCompare(b.key));
  const done = () => { setDraft(null); configs.refresh(); hosts.refresh(); setTimeout(() => (trigger.current?.isConnected ? trigger.current : heading.current)?.focus(), 0); };
  return <section className="dashboard-panel admin-vms" id="nomes-vms"><div className="panel-heading"><h2 ref={heading} tabIndex={-1}>Máquinas virtuais</h2><Button onClick={() => { hosts.refresh(); configs.refresh(); }}>Atualizar VMs</Button></div>
    <div className="admin-form"><p>Personalize o nome das VMs, inclusive as que não possuem Agent.</p>
      {configs.failed && <ReadError refresh={configs.refresh}>Não foi possível ler os nomes salvos.</ReadError>}
      {!canCreate && <p className="admin-notice">Descoberta indisponível ou desatualizada. Preferências existentes continuam editáveis.</p>}
      <div className="admin-fields"><Field label="Buscar VM por nome ou ID"><input type="search" value={query} onChange={event => setQuery(event.target.value)} /></Field><Field label="Hipervisor das VMs"><select value={parent} onChange={event => setParent(event.target.value)}><option value="">Todos os hipervisores</option>{[...new Set([...discovered.map(vm => vm.parentHostKey), ...(configs.data ?? []).map(config => config.hostKey)])].sort().map(key => <option key={key}>{key}</option>)}</select></Field></div>
      {draft && <VmNameForm key={draft.key} draft={draft} done={done} />}
    </div>{[false, true].map(orphan => rows.some(row => row.orphan === orphan) && <div key={String(orphan)}>{orphan && <h3 className="panel-heading">Preferências sem descoberta atual</h3>}<ul className="admin-saved-list">{rows.filter(row => row.orphan === orphan).map(row => <li key={row.key}><div><strong>{row.label}</strong>{row.label !== row.name && <p>{row.name}</p>}<p>{row.host} · ID {row.id ?? "não informado"} · {row.orphan ? "Preferência sem descoberta atual" : row.agent ? `Agent: ${row.agent}` : "Sem Agent associado"}</p></div><Button disabled={configs.failed || !configs.data || !saved.has(row.key) && !canCreate} onClick={event => { trigger.current = event.currentTarget; setDraft({ key: row.key, name: row.name, config: saved.get(row.key), canCreate: canCreate && !row.orphan }); }}>Editar nome<span className="sr-only"> {row.label}</span></Button></li>)}</ul></div>)}
    {!rows.length && <p className="panel-empty">{hosts.loading || configs.loading ? "Carregando VMs…" : "Nenhuma VM corresponde à seleção."}</p>}
  </section>;
}
