"use client";
import { useState } from "react";
import { blockCatalog, type PresentationDocument } from "@/lib/config/presentation";
import { assignOverviewSlot, canPlaceOverviewBlock, canStackOverviewBlock, emptyOverviewSlots, overviewSlotKeys, overviewSlotLabels, type OverviewSlots, type OverviewSlotKey } from "@/lib/config/overview-slots";
import { Button } from "@/components/ui/button";
import { Field } from "./shared";
import type { AvailabilityCatalogItem } from "./block-options";
import "./overview-slots.css";

export function OverviewSlotsEditor({ screen, catalog, onChange }: { screen: PresentationDocument["screens"][number]; catalog: AvailabilityCatalogItem[]; onChange: (slots: OverviewSlots) => void }) {
  const slots = screen.overviewSlots ?? emptyOverviewSlots();
  const [paired, setPaired] = useState<Partial<Record<OverviewSlotKey, boolean>>>({});
  const label = (id: string) => {
    const index = screen.blocks.findIndex(block => block.id === id), block = screen.blocks[index];
    if (!block) return "Painel removido";
    const name = block.type === "storage_summary" ? catalog.find(item => item.kind === "storage" && item.id === block.options?.storageConfigId)?.label : null;
    return `${name || blockCatalog[block.type].label} · Bloco ${index + 1}${block.enabled ? "" : " · desabilitado"}`;
  };
  const assigned = new Set(overviewSlotKeys.flatMap(key => slots[key]));
  const missing = screen.blocks.filter(block => block.enabled && block.type !== "summary" && !assigned.has(block.id));
  return <section className="admin-slot-editor" aria-label="Espaços da tela">
    <p className="admin-muted">Escolha um painel ou dois empilhados em cada espaço. Os Indicadores continuam acima. Os painéis mantêm suas configurações; a posição será compartilhada em Salvar apresentação.</p>
    <div className="admin-slot-grid">{overviewSlotKeys.map(key => {
      const two = paired[key] ?? slots[key].length === 2;
      const select = (index: number) => <Field label={two ? index ? "Painel inferior" : "Painel superior" : "Painel"}><select value={slots[key][index] ?? ""} disabled={index === 1 && !slots[key][0]} onChange={event => onChange(assignOverviewSlot(slots, key, index, event.target.value))}>
        <option value="">Nenhum painel</option>{screen.blocks.filter(block => two ? canStackOverviewBlock(block.type) : canPlaceOverviewBlock(block.type)).map(block => <option key={block.id} value={block.id}>{label(block.id)}</option>)}
      </select></Field>;
      return <fieldset className="admin-slot" key={key}><legend>{overviewSlotLabels[key]}</legend>
        <Field label="Organização"><select value={two ? "pair" : "single"} onChange={event => {
          const next = event.target.value === "pair";
          setPaired(value => ({ ...value, [key]: next }));
          onChange({ ...slots, [key]: next ? slots[key].filter(id => canStackOverviewBlock(screen.blocks.find(block => block.id === id)!.type)) : slots[key].slice(0, 1) });
        }}><option value="single">Painel único</option><option value="pair">Dois painéis empilhados</option></select></Field>
        {select(0)}{two && select(1)}
        <div className="admin-actions"><Button type="button" disabled={!slots[key].length} onClick={() => onChange({ ...slots, [key]: [] })}>Esvaziar espaço</Button>{two && <Button type="button" disabled={slots[key].length < 2} onClick={() => onChange({ ...slots, [key]: [...slots[key]].reverse() })}>Inverter painéis</Button>}</div>
      </fieldset>;
    })}</div>
    {!!missing.length && <div className="admin-notice" role="status"><strong>Painéis sem posição</strong><ul>{missing.map(block => <li key={block.id}>{label(block.id)}{!canPlaceOverviewBlock(block.type) ? " — use outro modelo de grade ou desabilite este tipo de bloco." : " — escolha um espaço acima."}</li>)}</ul></div>}
  </section>;
}
