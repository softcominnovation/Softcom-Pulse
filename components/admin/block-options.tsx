"use client";

import { ArrowDown, ArrowUp } from "lucide-react";
import { defaultIndicators, effectiveOptions, indicatorKeys, type IndicatorKey, type PresentationBlock } from "@/lib/config/presentation";
import {
  availabilityCardKinds, formatAvailabilityCardRef, parseAvailabilityCardRef,
  type AvailabilityCardKind,
} from "@/lib/config/availability-card-refs";
import { Button } from "@/components/ui/button";
import { Check, Field } from "./shared";

const labels: Record<string, string> = {
  name: "Nome", configured: "Ordem do recurso", state: "Estado", status: "Estado", health: "Healthcheck",
  cpu: "CPU (%)", memory: "Memória (%)", severity: "Severidade", recent: "Data de início", uptime: "Disponibilidade 24 h",
  hosts: "Hosts monitorados", containers_running: "Containers em execução", containers_stopped: "Containers parados",
  problems: "Problemas ativos", jobs_waiting: "Jobs aguardando",
  running: "Em execução", stopped: "Parado", paused: "Pausado", unknown: "Desconhecido",
};

const availabilityKindMeta: Record<AvailabilityCardKind, { title: string; hint: string; short: string }> = {
  resource: { title: "Recursos Zabbix", hint: "Hosts, ASGARD e containers com Agent", short: "Zabbix" },
  external_service: { title: "Aplicações", hint: "Sondas HTTP de disponibilidade", short: "Aplicação" },
  standalone_vps: { title: "VPS avulsas", hint: "VPS com monitoramento próprio", short: "VPS" },
  signal_target: { title: "Softcom Signal", hint: "Alvos Signal na grade", short: "Signal" },
};

export type AvailabilityCatalogItem = { kind: AvailabilityCardKind; id: string; label: string; detail?: string };

function IndicatorEditor({ selected, onChange }: { selected: IndicatorKey[]; onChange: (next: IndicatorKey[]) => void }) {
  const move = (index: number, direction: number) => {
    const next = [...selected];
    const target = index + direction;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    onChange(next);
  };
  return <div className="admin-indicator-editor">
    <p className="admin-muted">Até 4 indicadores por tela. Inclua, remova e ordene os cards pré-configurados.</p>
    <ol className="admin-indicator-order" aria-label="Ordem dos indicadores">
      {selected.map((key, index) => <li key={key}>
        <span>{labels[key] ?? key}</span>
        <span className="admin-actions">
          <Button type="button" size="icon" disabled={index === 0} aria-label={`Mover ${labels[key]} para cima`} onClick={() => move(index, -1)}><ArrowUp aria-hidden="true" /></Button>
          <Button type="button" size="icon" disabled={index === selected.length - 1} aria-label={`Mover ${labels[key]} para baixo`} onClick={() => move(index, 1)}><ArrowDown aria-hidden="true" /></Button>
        </span>
      </li>)}
    </ol>
    <fieldset>
      <legend>Catálogo de indicadores</legend>
      <div className="admin-checks">
        {indicatorKeys.map(key => {
          const checked = selected.includes(key);
          const atLimit = selected.length >= 4 && !checked;
          return <Check key={key} label={labels[key] ?? key}>
            <input
              type="checkbox"
              checked={checked}
              disabled={atLimit || (checked && selected.length === 1)}
              onChange={event => {
                if (event.target.checked) onChange([...selected, key]);
                else onChange(selected.filter(item => item !== key));
              }}
            />
          </Check>;
        })}
      </div>
    </fieldset>
    <Button type="button" onClick={() => onChange([...defaultIndicators])}>Restaurar indicadores padrão</Button>
  </div>;
}

export function BlockOptionsEditor({ block, hosts, onChange, availabilityCatalog = [] }: {
  block: PresentationBlock; hosts: { hostKey: string; name: string }[];
  onChange: (options: NonNullable<PresentationBlock["options"]>) => void;
  availabilityCatalog?: AvailabilityCatalogItem[];
}) {
  const options = { ...effectiveOptions({ type: block.type }), ...block.options } as NonNullable<PresentationBlock["options"]>;
  const set = (key: string, value: string | number | boolean | string[] | number[]) => onChange({ ...options, [key]: value });
  const checkList = (key: string, values: (string | number)[], names?: string[]) => <div className="admin-checks">{values.map((value, index) => <Check key={value} label={names?.[index] ?? labels[value] ?? String(value)}><input type="checkbox" checked={(options[key] as (string | number)[]).includes(value)} onChange={event => { const selected = options[key] as (string | number)[]; set(key, (event.target.checked ? [...selected, value] : selected.filter(item => item !== value)) as string[] | number[]); }} /></Check>)}</div>;
  if (block.type === "summary") {
    return <IndicatorEditor selected={(options.indicators as IndicatorKey[]) ?? [...defaultIndicators]} onChange={next => set("indicators", next)} />;
  }
  if (block.type === "resource_card") return <p className="admin-muted">Métricas e estados seguem as preferências salvas do recurso.</p>;
  if (block.type === "uptime_list") return <div className="admin-options"><div className="admin-fields"><Field label="Ordenar por"><select value={String(options.sortBy)} onChange={event => set("sortBy", event.target.value)}>{(["name", "uptime", "state"] as const).map(key => <option key={key} value={key}>{labels[key]}</option>)}</select></Field><Field label="Direção"><select value={String(options.sortDirection)} onChange={event => set("sortDirection", event.target.value)}><option value="asc">Crescente</option><option value="desc">Decrescente</option></select></Field><Field label="Linhas visíveis" hint="As demais aplicações continuam acessíveis por rolagem."><select value={Number(options.visibleRows)} onChange={event => set("visibleRows", Number(event.target.value))}>{Array.from({ length: 8 }, (_, i) => i + 3).map(value => <option key={value}>{value}</option>)}</select></Field></div>{options.sortBy === "uptime" && <p className="admin-muted">A disponibilidade de 24 h conta somente consultas disponíveis ou lentas. Sem amostras fica no fim.</p>}{options.sortBy === "state" && <p className="admin-muted">Crescente: disponível, lento, falha na consulta e indisponível. Sem dados fica no fim.</p>}</div>;
  if (block.type === "signal_flow") return <div className="admin-options"><div className="admin-fields"><Field label="Linhas do pipeline" hint="Filas outbox/inbox e dead letter do ready atual. Jobs em fila/rodando/pendentes vêm do knowledge index."><select value={Number(options.visibleRows)} onChange={event => set("visibleRows", Number(event.target.value))}>{Array.from({ length: 8 }, (_, i) => i + 3).map(value => <option key={value}>{value}</option>)}</select></Field></div><p className="admin-muted">Sem inventar volume de jobs / 30 min — o bloco usa só métricas do ready.</p></div>;
  if (block.type === "highlighted_resources") {
    const selection = String(options.selection ?? "default") as "default" | "custom";
    const cards = (Array.isArray(options.cards) ? options.cards : []).map(String);
    const byRef = new Map(availabilityCatalog.map(item => [formatAvailabilityCardRef(item), item]));
    const moveCard = (index: number, direction: number) => {
      const next = [...cards], target = index + direction;
      if (target < 0 || target >= next.length) return;
      [next[index], next[target]] = [next[target], next[index]];
      set("cards", next);
    };
    const addCard = (item: AvailabilityCatalogItem) => {
      const ref = formatAvailabilityCardRef(item);
      if (cards.length >= 8 || cards.includes(ref)) return;
      set("cards", [...cards, ref]);
    };
    return <div className="admin-options">
      <div className="admin-fields">
        <Field label="Conteúdo do bloco" hint="Padrão usa os destaques globais (dashboardEnabled). Personalizado fixa a lista só deste bloco.">
          <select value={selection} onChange={event => {
            const next = event.target.value as "default" | "custom";
            onChange({ ...options, selection: next, cards: next === "default" ? [] : cards });
          }}>
            <option value="default">Padrão (destaques globais)</option>
            <option value="custom">Personalizado</option>
          </select>
        </Field>
        <Field label="Fileiras visíveis" hint="1 = uma fileira (padrão). 2 = até 8 cards. Na grade em duas colunas, use 2 fileiras para preencher a altura da coluna esquerda.">
          <select value={Number(options.visibleRows)} onChange={event => set("visibleRows", Number(event.target.value))}>
            <option value={1}>1 fileira · até 4 cards</option>
            <option value={2}>2 fileiras · até 8 cards</option>
          </select>
        </Field>
      </div>
      {selection === "default" ? <>
        <div className="admin-fields">
          <Field label="Ordenar por"><select value={String(options.sortBy)} onChange={event => set("sortBy", event.target.value)}>{(["configured", "name"] as const).map(key => <option key={key} value={key}>{labels[key]}</option>)}</select></Field>
          <Field label="Direção"><select value={String(options.sortDirection)} onChange={event => set("sortDirection", event.target.value)}><option value="asc">Crescente</option><option value="desc">Decrescente</option></select></Field>
        </div>
        <Check label="Somente recursos críticos"><input type="checkbox" checked={!!options.criticalOnly} onChange={event => set("criticalOnly", event.target.checked)} /></Check>
        <p className="admin-muted">Usa recursos, aplicações, VPS e Signal com destaque global. A lista personalizada será descartada ao salvar neste modo.</p>
      </> : <>
        <p className="admin-muted">Até 8 cards na ordem da grade. Inclua cadastros habilitados (com ou sem “Destacar no dashboard”). Órfãos somem sem placeholder.</p>
        <div className="admin-availability-selected">
          <h4>Neste bloco · {cards.length} de 8</h4>
          {cards.length === 0 && <p className="admin-muted">Nenhum card neste bloco. A grade ficará vazia até você adicionar.</p>}
          <ol className="admin-indicator-order" aria-label="Cards do bloco">
            {cards.map((ref, index) => {
              const parsed = parseAvailabilityCardRef(ref);
              const known = byRef.get(ref);
              const name = known?.label ?? "indisponível";
              const kindLabel = parsed ? availabilityKindMeta[parsed.kind].short : "Card";
              const aria = `${kindLabel} · ${name}`;
              return <li key={ref}>
                <span className="admin-availability-card-meta">
                  <span className="admin-availability-kind">{kindLabel}</span>
                  <strong>{name}</strong>
                  {known?.detail && <small>{known.detail}</small>}
                </span>
                <span className="admin-actions">
                  <Button type="button" size="icon" disabled={index === 0} aria-label={`Mover ${aria} para cima`} onClick={() => moveCard(index, -1)}><ArrowUp aria-hidden="true" /></Button>
                  <Button type="button" size="icon" disabled={index === cards.length - 1} aria-label={`Mover ${aria} para baixo`} onClick={() => moveCard(index, 1)}><ArrowDown aria-hidden="true" /></Button>
                  <Button type="button" onClick={() => set("cards", cards.filter(item => item !== ref))}>Remover</Button>
                </span>
              </li>;
            })}
          </ol>
        </div>
        <div className="admin-availability-catalog" aria-label="Catálogo de cards disponíveis">
          {availabilityCardKinds.map(kind => {
            const meta = availabilityKindMeta[kind];
            const available = availabilityCatalog.filter(item => item.kind === kind && !cards.includes(formatAvailabilityCardRef(item)));
            const atLimit = cards.length >= 8;
            return <section key={kind} className="admin-availability-group" aria-label={meta.title}>
              <header>
                <h4>{meta.title}</h4>
                <p className="admin-muted">{meta.hint} · {available.length} {available.length === 1 ? "disponível" : "disponíveis"}</p>
              </header>
              {available.length ? <ul className="admin-availability-picks">
                {available.map(item => <li key={formatAvailabilityCardRef(item)}>
                  <label className="admin-availability-pick">
                    <input type="checkbox" checked={false} disabled={atLimit} aria-label={`${meta.short} · ${item.label}`} onChange={event => { if (event.target.checked) addCard(item); }} />
                    <span className="admin-availability-pick-text">
                      <strong>{item.label}</strong>
                      {item.detail && <small>{item.detail}</small>}
                    </span>
                  </label>
                </li>)}
              </ul> : <p className="admin-muted">Nenhum cadastro habilitado nesta família.</p>}
            </section>;
          })}
        </div>
        {cards.length >= 8 && <p className="admin-muted">Limite de 8 cards neste bloco.</p>}
      </>}
    </div>;
  }
  const sorts = block.type === "problems" ? ["severity", "recent"] : block.type === "container_inventory" ? ["name", "status", "health", "cpu", "memory"] : ["name", "state", "cpu", "memory"];
  return <div className="admin-options"><div className="admin-fields"><Field label="Ordenar por"><select value={String(options.sortBy)} onChange={event => set("sortBy", event.target.value)}>{sorts.map(key => <option key={key} value={key}>{labels[key]}</option>)}</select></Field><Field label="Direção"><select value={String(options.sortDirection)} onChange={event => set("sortDirection", event.target.value)}><option value="asc">Crescente</option><option value="desc">Decrescente</option></select></Field><Field label="Linhas visíveis" hint="Os demais itens continuam acessíveis por rolagem."><select value={Number(options.visibleRows)} onChange={event => set("visibleRows", Number(event.target.value))}>{Array.from({ length: 8 }, (_, i) => i + 3).map(value => <option key={value}>{value}</option>)}</select></Field></div>
    {options.sortBy === "health" && <p className="admin-muted">Crescente: falha, iniciando, saudável, sem healthcheck. Desconhecidos ficam sempre no fim.</p>}
    {options.sortBy === "state" && <p className="admin-muted">Crescente: execução, pausado, parado (VMs); disponível, indisponível (hosts). Desconhecidos ficam no fim.</p>}
    {block.type === "asgard_summary" && <fieldset><legend>Estados incluídos</legend>{checkList("states", ["running", "paused", "stopped", "unknown"])}</fieldset>}
    {block.type === "problems" && <fieldset><legend>Severidades incluídas</legend>{checkList("severities", [0, 1, 2, 3, 4, 5], ["Não classificado", "Informação", "Atenção", "Média", "Alta", "Desastre"])}</fieldset>}
    {block.type === "container_inventory" && <fieldset><legend>Hosts dos containers</legend><Check label="Todos os hosts"><input type="checkbox" checked={options.hostKeys === undefined} onChange={event => { if (event.target.checked) { const next = { ...options }; delete next.hostKeys; onChange(next); } else set("hostKeys", []); }} /></Check>{options.hostKeys !== undefined && <div className="admin-checks">{[...new Map([...hosts, ...(options.hostKeys as string[]).filter(key => !hosts.some(host => host.hostKey === key)).map(hostKey => ({ hostKey, name: `${hostKey} · sem descoberta atual` }))].map(item => [item.hostKey, item])).values()].map(host => <Check key={host.hostKey} label={host.name}><input type="checkbox" checked={(options.hostKeys as string[]).includes(host.hostKey)} onChange={event => set("hostKeys", event.target.checked ? [...options.hostKeys as string[], host.hostKey] : (options.hostKeys as string[]).filter(key => key !== host.hostKey))} /></Check>)}</div>}</fieldset>}
  </div>;
}
