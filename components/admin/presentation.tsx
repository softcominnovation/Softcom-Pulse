"use client";

import { useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { toast } from "sonner";
import { ArrowUp, ArrowDown, Copy, Plus } from "lucide-react";
import { api } from "@/lib/client/api";
import { blockCatalog, blockTypes, defaultDisplayScalePercent, displayScaleOptions, effectiveOptions, initialPresentation, presentationDocumentSchema, presentationSettingsSchema, type BlockType, type PresentationBlock, type PresentationDocument, type PresentationSettings } from "@/lib/config/presentation";
import type { ResourceConfig } from "@/lib/config/resources";
import { useHosts } from "@/components/infrastructure/data";
import { Button } from "@/components/ui/button";
import { ConfirmationDialog } from "@/components/confirmation-dialog";
import { Check, Field, ReadError, errorText, useAdminRead, useMutation } from "./shared";
import { parseResources } from "./resources";
import { BlockOptionsEditor } from "./block-options";
import { PresentationPreview } from "./presentation-preview";
import { FullscreenHelp } from "./fullscreen-help";

const parseDocument = (data: unknown) => presentationDocumentSchema.parse((data as { data: unknown }).data);
function editable(document: PresentationDocument): PresentationSettings {
  const { revision, ...settings } = document;
  void revision;
  return { ...settings, schemaVersion: 2, screens: settings.screens.map(screen => ({ ...screen, blocks: screen.blocks.map(block => ({ ...block, options: effectiveOptions(block) })) })) };
}
function reorder<T>(array: T[], index: number, direction: number) { const result = [...array]; [result[index], result[index + direction]] = [result[index + direction], result[index]]; return result; }
function MoveButtons({ label, index, length, move }: { label: string; index: number; length: number; move: (direction: number) => void }) {
  return <><Button type="button" size="icon" disabled={index === 0} aria-label={`Mover ${label} para cima`} onClick={() => move(-1)}><ArrowUp aria-hidden="true" /></Button><Button type="button" size="icon" disabled={index === length - 1} aria-label={`Mover ${label} para baixo`} onClick={() => move(1)}><ArrowDown aria-hidden="true" /></Button></>;
}
function PresentationForm({ saved, resources, hosts, reload }: { saved: PresentationDocument; resources: ResourceConfig[]; hosts: { hostKey: string; name: string }[]; reload: () => void }) {
  const form = useForm<PresentationSettings>({ defaultValues: editable(saved) }), settings = useWatch({ control: form.control }) as PresentationSettings, mutation = useMutation();
  const [confirmed, setConfirmed] = useState(saved), [readingError, setReadingError] = useState("");
  const [error, setError] = useState(""), [previewId, setPreviewId] = useState<string | null>(null);
  const [newTypes, setNewTypes] = useState<Record<string, BlockType>>({});
  const validation = presentationSettingsSchema.safeParse(settings);
  const eligibleResources = resources.filter(resource => resource.enabled && resource.dashboardEnabled);
  const changeScreens = (screens: PresentationSettings["screens"]) => form.setValue("screens", screens, { shouldDirty: true });
  const changeBlocks = (screenIndex: number, blocks: PresentationBlock[]) => changeScreens(settings.screens.map((screen, index) => index === screenIndex ? { ...screen, blocks } : screen));
  const changeBlock = (screenIndex: number, blockIndex: number, block: PresentationBlock) => changeBlocks(screenIndex, settings.screens[screenIndex].blocks.map((current, index) => index === blockIndex ? block : current));
  const reset = () => { form.reset(editable(confirmed)); setError(""); setReadingError(""); setPreviewId(null); };
  const saveReading = async () => {
    const { revision, ...base } = confirmed, draft = form.getValues();
    const parsed = presentationSettingsSchema.safeParse({ ...base, displayScalePercent: draft.displayScalePercent, showStatusBanner: draft.showStatusBanner, idlePresentation: draft.idlePresentation });
    setReadingError("");
    if (!parsed.success) { setReadingError("Escolha um tamanho válido e informe um tempo inteiro entre 1 e 120 minutos."); return; }
    try {
      const result = await mutation.run(async signal => parseDocument((await api.put("/settings/presentation", { expectedRevision: revision, settings: parsed.data }, { signal })).data));
      if (result) { setConfirmed(result); toast.success("Leitura do telão salva. As outras alterações continuam no rascunho."); }
    } catch (failure) { setReadingError(errorText(failure)); }
  };
  const submit = form.handleSubmit(async input => {
    const parsed = presentationSettingsSchema.safeParse(input); setError("");
    if (!parsed.success) { setError("Revise os limites e as opções indicados abaixo antes de salvar."); return; }
    try { const result = await mutation.run(async signal => parseDocument((await api.put("/settings/presentation", { expectedRevision: confirmed.revision, settings: parsed.data }, { signal })).data)); if (result) { toast.success("Apresentação do dashboard salva."); reload(); } }
    catch (failure) { setError(errorText(failure)); }
  });
  return <section className="admin-presentation"><form onSubmit={submit} aria-label="Configurações da apresentação">
    <section className="dashboard-panel"><div className="panel-heading"><h2>Reprodução das telas</h2></div><div className="admin-form">
      <fieldset disabled={mutation.busy}><div className="admin-fields">
        <Field label="Intervalo da alternância (segundos)" hint="De 5 a 300 segundos. A alternância requer duas telas habilitadas."><input type="number" min={5} max={300} {...form.register("rotation.intervalSeconds", { valueAsNumber: true })} /></Field>
        <Check label="Iniciar no modo TV"><input type="checkbox" {...form.register("defaultTvMode")} /></Check>
        <Check label="Iniciar alternância automaticamente"><input type="checkbox" {...form.register("rotation.autoStart")} /></Check>
      </div></fieldset>
      <p className="admin-muted">O modo TV mantém a reprodução limpa. Configure abaixo a entrada por inatividade ou use os controles do dashboard.</p>
      <p>Ordem: {settings.screens.filter(screen => screen.enabled).map(screen => screen.name || "Tela sem nome").join(" → ") || "Nenhuma tela habilitada"}</p>
    </div></section>
    <section className="dashboard-panel admin-reading" aria-label="Leitura no telão"><div className="panel-heading"><h2>Leitura no telão</h2></div><div className="admin-form">
      <fieldset disabled={mutation.busy}><div className="admin-fields admin-reading-fields">
        <Field label="Tamanho dos elementos no telão" hint="Aplicado uma única vez no dashboard em modo TV ou tela cheia. A navegação normal mantém 100%." action={<Button type="button" onClick={() => form.setValue("displayScalePercent", defaultDisplayScalePercent, { shouldDirty: true })}>Restaurar tamanho padrão</Button>}>
          <select {...form.register("displayScalePercent", { valueAsNumber: true })}>{displayScaleOptions.map(value => <option key={value} value={value}>{value}%{value === defaultDisplayScalePercent ? " · padrão" : ""}</option>)}</select>
        </Field>
        <Field label="Tempo sem interação (minutos)" hint="De 1 a 120 minutos. Padrão: 5 minutos. Mouse, toque, teclado e rolagem reiniciam a contagem.">
          <input type="number" min={1} max={120} step={1} {...form.register("idlePresentation.afterMinutes", { valueAsNumber: true })} />
        </Field>
      </div><div className="admin-checks admin-reading-checks">
        <Check label="Entrar no modo TV após inatividade"><input type="checkbox" {...form.register("idlePresentation.enabled")} /></Check>
        <Check label="Tentar tela cheia ao entrar automaticamente"><input type="checkbox" {...form.register("idlePresentation.requestFullscreen")} /></Check>
        <Check label="Exibir faixa de status do monitoramento"><input type="checkbox" {...form.register("showStatusBanner")} /></Check>
      </div></fieldset>
      <p className="admin-muted">A faixa de status (atualização, falha e horário da coleta) fica oculta por padrão. Só aparece no dashboard quando esta opção estiver marcada e salva.</p>
      <p className="admin-muted">A entrada por inatividade funciona somente no dashboard principal. A contagem fica suspensa com a aba oculta ou um diálogo aberto. O navegador pode exigir um clique para concluir a tela cheia; nesse caso, o modo TV entra e aparece um botão para continuar.</p>
      <FullscreenHelp />
      <p className="admin-muted">Use “Ver prévia” em uma tela para comparar tamanhos; opções maiores podem precisar de rolagem.</p>
      {readingError && <p role="alert" className="admin-error">{readingError}</p>}
      <div className="admin-panel-save"><p className="admin-muted">Salvo no banco e compartilhado entre os dispositivos. Este botão salva somente as opções deste bloco.</p><Button type="button" variant="primary" disabled={mutation.busy} onClick={() => { void saveReading(); }}>Salvar leitura do telão</Button></div>
    </div></section>
    {saved.schemaVersion === 1 && settings.screens.some(screen => screen.blocks.filter(block => block.enabled).length > 6) && <p className="admin-notice">Esta composição antiga continua sendo reproduzida integralmente. Distribua ou desabilite blocos até haver no máximo seis habilitados por tela para salvar a nova versão.</p>}
    <fieldset disabled={mutation.busy} className="admin-screens">{settings.screens.map((screen, screenIndex) => {
      const count = screen.blocks.filter(block => block.enabled).length;
      return <section className="dashboard-panel admin-screen" key={screen.id} aria-label={`Tela ${screenIndex + 1}`}><div className="panel-heading"><h2>Tela {screenIndex + 1} · {screen.name}</h2><div className="admin-actions"><MoveButtons label={`tela ${screenIndex + 1}`} index={screenIndex} length={settings.screens.length} move={direction => changeScreens(reorder(settings.screens, screenIndex, direction))} /><ConfirmationDialog trigger={<Button type="button" disabled={settings.screens.length === 1}>Remover tela</Button>} title="Remover tela da composição?" description="A tela e seus blocos serão retirados do rascunho. A apresentação compartilhada só muda depois de salvar." confirmLabel="Remover tela" destructive onConfirm={() => { changeScreens(settings.screens.filter(item => item.id !== screen.id)); if (previewId === screen.id) setPreviewId(null); }} /></div></div>
        <div className="admin-form"><div className="admin-fields"><Field label="Nome da tela"><input maxLength={80} {...form.register(`screens.${screenIndex}.name`)} /></Field><Field label="Formato"><select {...form.register(`screens.${screenIndex}.layout`)}><option value="overview">Visão geral</option><option value="wall">Tela completa</option></select></Field><Check label="Tela habilitada"><input type="checkbox" {...form.register(`screens.${screenIndex}.enabled`)} /></Check></div>
        <p className={count > 6 ? "admin-error" : "admin-muted"}>{count} de 6 blocos habilitados · {screen.blocks.length} de 24 blocos cadastrados</p>
        {screen.blocks.map((block, blockIndex) => <article className="admin-block" key={block.id} aria-label={`${blockCatalog[block.type].label} na tela ${screenIndex + 1}`}><div className="admin-block-heading"><h3>{blockCatalog[block.type].label}</h3><div className="admin-actions"><MoveButtons label={`${blockCatalog[block.type].label} na tela ${screenIndex + 1}`} index={blockIndex} length={screen.blocks.length} move={direction => changeBlocks(screenIndex, reorder(screen.blocks, blockIndex, direction))} /><Button type="button" size="icon" aria-label={`Duplicar ${blockCatalog[block.type].label}`} disabled={screen.blocks.length >= 24} onClick={() => changeBlocks(screenIndex, [...screen.blocks, { ...structuredClone(block), id: crypto.randomUUID(), enabled: count < 6 && block.enabled }])}><Copy aria-hidden="true" /></Button><ConfirmationDialog trigger={<Button type="button">Remover bloco</Button>} title="Remover bloco desta tela?" description="O bloco será retirado do rascunho. As configurações do recurso e as demais telas serão preservadas." confirmLabel="Remover bloco" destructive onConfirm={() => changeBlocks(screenIndex, screen.blocks.filter(item => item.id !== block.id))} /></div></div>
          <div className="admin-fields"><Check label="Bloco habilitado"><input type="checkbox" checked={block.enabled} disabled={!block.enabled && count >= 6} onChange={event => changeBlock(screenIndex, blockIndex, { ...block, enabled: event.target.checked })} /></Check><Field label="Largura"><select value={block.width} onChange={event => changeBlock(screenIndex, blockIndex, { ...block, width: event.target.value as PresentationBlock["width"] })}><option value="standard">Padrão · um terço</option><option value="wide">Ampla · metade</option><option value="full">Inteira</option></select></Field><Field label="Associado à tela"><select value={screen.id} onChange={event => { const target = settings.screens.find(item => item.id === event.target.value)!; if (target.blocks.length >= 24 || block.enabled && target.blocks.filter(item => item.enabled).length >= 6) { setError("A tela de destino atingiu o limite. Desabilite um bloco antes de mover."); return; } changeScreens(settings.screens.map(item => item.id === screen.id ? { ...item, blocks: item.blocks.filter(candidate => candidate.id !== block.id) } : item.id === target.id ? { ...item, blocks: [...item.blocks, block] } : item)); }} >{settings.screens.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></Field></div>
          {block.type === "resource_card" && <Field label="Recurso individual"><select value={block.resourceConfigId ?? ""} onChange={event => changeBlock(screenIndex, blockIndex, { ...block, resourceConfigId: event.target.value })}>{!eligibleResources.some(item => item.id === block.resourceConfigId) && <option value={block.resourceConfigId ?? ""}>Referência indisponível · escolha um recurso</option>}{eligibleResources.map(item => <option key={item.id} value={item.id}>{item.displayName ?? item.selectorValue ?? item.zabbixHostKey} · {item.zabbixHostKey}</option>)}</select></Field>}
          <BlockOptionsEditor block={block} hosts={hosts} onChange={options => changeBlock(screenIndex, blockIndex, { ...block, options })} />
        </article>)}
        <div className="admin-add"><Field label="Novo bloco"><select value={newTypes[screen.id] ?? "summary"} onChange={event => setNewTypes({ ...newTypes, [screen.id]: event.target.value as BlockType })}>{blockTypes.map(type => <option key={type} value={type} disabled={!blockCatalog[type].available || (type === "resource_card" && !eligibleResources.length)}>{blockCatalog[type].label}</option>)}</select></Field><Button type="button" disabled={screen.blocks.length >= 24} onClick={() => { const type = newTypes[screen.id] ?? "summary"; if (!blockCatalog[type].available || (type === "resource_card" && !eligibleResources.length)) return; changeBlocks(screenIndex, [...screen.blocks, { id: crypto.randomUUID(), type, enabled: count < 6, width: type === "summary" || type === "highlighted_resources" ? "full" : "standard", options: effectiveOptions({ type }), ...(type === "resource_card" ? { resourceConfigId: eligibleResources[0].id } : {}) }]); }}><Plus aria-hidden="true" />Adicionar bloco</Button><Button type="button" onClick={() => setPreviewId(previewId === screen.id ? null : screen.id)}>{previewId === screen.id ? "Fechar prévia" : "Ver prévia"}</Button></div>{count >= 6 && <p className="admin-muted">Limite de seis habilitados. Novos blocos entram desabilitados; mova-os para outra tela ou desative um existente.</p>}
        </div>
      </section>;
    })}</fieldset>
    <div className="admin-actions"><Button type="button" disabled={settings.screens.length >= 3 || mutation.busy} onClick={() => changeScreens([...settings.screens, { id: crypto.randomUUID(), name: `Tela ${settings.screens.length + 1}`, layout: "overview", enabled: true, blocks: [{ id: crypto.randomUUID(), type: "summary", width: "full", enabled: true, options: effectiveOptions({ type: "summary" }) }] }])}><Plus aria-hidden="true" />Adicionar tela</Button><span className="admin-muted">{settings.screens.length} de 3 telas</span></div>
    {!validation.success && <div className="admin-notice" role="status"><strong>Revise a composição</strong><ul>{validation.error.issues.map((issue, index) => <li key={index}>{issue.path[0] === "screens" && typeof issue.path[1] === "number" ? `Tela ${issue.path[1] + 1}${typeof issue.path[3] === "number" ? `, bloco ${issue.path[3] + 1}` : ""}: ` : ""}{issue.path.includes("options") ? "selecione ao menos uma opção válida para cada filtro e indicador." : issue.path.includes("name") ? "informe um nome de até 80 caracteres." : issue.path.includes("autoStart") ? "a alternância automática exige duas telas habilitadas com blocos." : issue.path.includes("intervalSeconds") ? "o intervalo deve ser um inteiro entre 5 e 300 segundos." : issue.path.includes("afterMinutes") ? "o tempo sem interação deve ser um inteiro entre 1 e 120 minutos." : "mantenha pelo menos uma tela e um bloco habilitados, até seis blocos por tela."}</li>)}</ul></div>}
    {error && <p role="alert" className="admin-error">{error}</p>}
    <div className="admin-savebar"><Button type="submit" variant="primary" disabled={mutation.busy}>{mutation.busy ? "Salvando…" : "Salvar apresentação"}</Button><Button type="button" disabled={mutation.busy} onClick={reset}>Cancelar alterações</Button><ConfirmationDialog trigger={<Button type="button" disabled={mutation.busy}>Restaurar composição inicial</Button>} title="Restaurar composição inicial?" description="O rascunho será substituído pela tela padrão: indicadores, destaques, ASGARD e problemas. Salvar confirmará a mudança para todos." confirmLabel="Restaurar composição" onConfirm={() => { form.reset(editable(initialPresentation(() => crypto.randomUUID()))); setPreviewId(null); }} /><ConfirmationDialog trigger={<Button type="button" disabled={mutation.busy}>Recarregar para revisar</Button>} title="Recarregar apresentação salva?" description="As alterações locais serão descartadas. A versão mais recente do banco será carregada para revisão." confirmLabel="Recarregar apresentação" onConfirm={reload} /></div>
  </form>{previewId && (validation.success ? <PresentationPreview screen={settings.screens.find(item => item.id === previewId)!} displayScalePercent={settings.displayScalePercent} /> : <p className="admin-notice">Ajuste os campos indicados para abrir a prévia da composição.</p>)}</section>;
}
export function PresentationAdmin() {
  const document = useAdminRead("/settings/presentation", parseDocument), resources = useAdminRead("/settings/resources", parseResources), hosts = useHosts();
  const [reloadKey, setReloadKey] = useState(0);
  const reload = () => { document.refresh(); resources.refresh(); setReloadKey(value => value + 1); };
  if (document.loading) return <p className="panel-empty" role="status">Carregando apresentação salva…</p>;
  if (document.failed || !document.data) return <ReadError refresh={document.refresh}>Não foi possível carregar a apresentação. Nenhum padrão será salvo sobre ela.</ReadError>;
  return <>{resources.failed && <ReadError refresh={resources.refresh}>Não foi possível ler os recursos para os blocos individuais. As referências existentes foram preservadas.</ReadError>}<PresentationForm key={`${document.data.revision}:${reloadKey}`} saved={document.data} resources={resources.data ?? []} hosts={hosts.data?.data ?? []} reload={reload} /></>;
}
