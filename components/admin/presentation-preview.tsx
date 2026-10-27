"use client";

import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import { z } from "zod";
import { api } from "@/lib/client/api";
import { effectiveOptions, type DisplayScalePercent, type PresentationSettings } from "@/lib/config/presentation";
import { externalServicePublicSchema } from "@/lib/config/external-services";
import { standaloneVpsCardSchema, type StandaloneVpsHighlight } from "@/lib/config/standalone-vps";
import {
  buildCustomAvailabilityCards, buildDefaultAvailabilityCards, type AvailabilityPanelData, type SignalAvailabilityCard,
} from "@/lib/dashboard/availability-cards";
import type { Overview, OverviewBlock, ProbeCard, ReadResult } from "@/lib/monitoring/contracts";
import { hostSchema, containerSchema, configuredResourceSchema } from "@/lib/monitoring/contracts";
import { readSchema, EvidenceClock } from "@/components/infrastructure/data";
import { DashboardBlock } from "@/components/dashboard/blocks";
import { displayBlockWidth } from "@/lib/dashboard/layout";
import { Button } from "@/components/ui/button";
import { Field } from "./shared";
import { storageInventorySchema } from "@/lib/storage/contracts";
import { StorageComposition } from "@/components/dashboard/storage-composition";

type Screen = PresentationSettings["screens"][number];

function asProbeCard(item: z.infer<typeof externalServicePublicSchema>): ProbeCard {
  return {
    id: item.id, displayName: item.displayName, description: item.description, serviceType: item.serviceType,
    displayOrder: item.displayOrder, critical: item.critical, dashboardEnabled: item.dashboardEnabled,
    paused: !item.enabled, progressStartedAt: item.progressStartedAt ?? null,
    reason: item.uptime?.reason ?? null, latencyMs: item.uptime?.latencyMs ?? null, checkedAt: item.uptime?.checkedAt ?? null,
    httpStatus: null, certNotAfter: null, uptime24h: item.uptime?.uptime24h ?? null, strip: item.uptime?.strip ?? [],
  };
}

function asVpsHighlight(item: z.infer<typeof standaloneVpsCardSchema>): StandaloneVpsHighlight {
  return {
    id: item.id, name: item.name, provider: item.provider, ip: item.ip, enabled: item.enabled,
    monitorConfigured: item.monitorConfigured, monitorPaused: item.monitorPaused, monitorState: item.monitorState,
    cpuPercent: item.cpuPercent, memoryPercent: item.memoryPercent, diskPercent: item.diskPercent,
    checkedAt: item.checkedAt, strip: item.strip,
  };
}

export function PresentationPreview({ screen, displayScalePercent }: { screen: Screen; displayScalePercent: DisplayScalePercent }) {
  const [tvPreview, setTvPreview] = useState(true);
  const [compositionScroll, setCompositionScroll] = useState(false);
  const scale = tvPreview ? displayScalePercent : 100;
  const [blocks, setBlocks] = useState<OverviewBlock[] | null>(null), [failed, setFailed] = useState(false), [scroll, setScroll] = useState(false), [loading, setLoading] = useState(false);
  const content = useRef<HTMLDivElement>(null), [reload, setReload] = useState(0);
  const signature = JSON.stringify(screen);
  const read = useCallback(async (signal: AbortSignal) => {
    const results = await Promise.allSettled([
      api.get<ReadResult<Overview>>("/dashboard/overview", { signal }).then(response => response.data),
      api.get("/monitoring/hosts", { signal }).then(response => readSchema(hostSchema.array()).parse(response.data)),
      api.get("/monitoring/containers", { signal }).then(response => readSchema(containerSchema.array()).parse(response.data)),
      api.get("/monitoring/services", { signal }).then(response => readSchema(configuredResourceSchema.array()).parse(response.data)),
      api.get("/monitoring/external-services", { signal }).then(response => z.object({ data: z.array(externalServicePublicSchema) }).parse(response.data).data),
      api.get("/monitoring/standalone-vps", { signal }).then(response => z.object({ data: z.array(standaloneVpsCardSchema) }).parse(response.data).data),
      api.get("/monitoring/signal-targets", { signal }).then(response => z.object({ data: z.array(z.object({
        id: z.string(), displayName: z.string(), description: z.string().nullable().optional(), critical: z.boolean().optional(),
        displayOrder: z.number().optional(), enabled: z.boolean(), dashboardEnabled: z.boolean().optional(),
        state: z.number().optional(), latencyMs: z.number().nullable().optional(),
        readyStatus: z.string().nullable().optional(), workerStatus: z.string().nullable().optional(), activeInstances: z.number().nullable().optional(),
        strip: z.array(z.number()).optional(), uptime24h: z.object({ available: z.number(), total: z.number() }).nullable().optional(),
        checkedAt: z.string().nullable().optional(),
      })) }).parse(response.data).data),
      api.get("/monitoring/storages", { signal }).then(response => readSchema(storageInventorySchema).parse(response.data)),
    ]);
    if (signal.aborted) return;
    const base = results[0].status === "fulfilled" ? results[0].value : null;
    const hosts = results[1].status === "fulfilled" ? results[1].value : null;
    const containers = results[2].status === "fulfilled" ? results[2].value : null;
    const services = results[3].status === "fulfilled" ? results[3].value : null;
    const apps = results[4].status === "fulfilled" ? results[4].value : [];
    const vpsRows = results[5].status === "fulfilled" ? results[5].value : [];
    const signalRows = results[6].status === "fulfilled" ? results[6].value : [];
    const storageResult = results[7].status === "fulfilled" ? results[7].value : null;
    const storageItems = storageResult ? [...storageResult.data.items, ...storageResult.data.orphans] : [];
    const storages = new Map(storageItems.flatMap(item => item.configId ? [[item.configId, item] as const] : []));
    const selected = JSON.parse(signature) as Screen;
    const allResources = services?.data.filter(item => item.config.enabled) ?? [];
    const highlightedResources = allResources.filter(item => item.config.dashboardEnabled);
    const probeCards = apps.filter(item => item.enabled).map(asProbeCard);
    const vpsCards = vpsRows.filter(item => item.enabled).map(asVpsHighlight);
    const signalCards: SignalAvailabilityCard[] = signalRows.filter(item => item.enabled).map(item => ({
      id: item.id, displayName: item.displayName, description: item.description ?? null, critical: item.critical ?? false,
      displayOrder: item.displayOrder ?? 0, enabled: item.enabled, state: item.state ?? 0, latencyMs: item.latencyMs ?? null,
      readyStatus: item.readyStatus ?? null, workerStatus: item.workerStatus ?? null, activeInstances: item.activeInstances ?? null,
      strip: item.strip ?? [], uptime24h: item.uptime24h ?? null, checkedAt: item.checkedAt ?? null,
    }));
    const highlightedProbes = base?.data.externalServices ?? probeCards.filter(item => item.dashboardEnabled);
    const highlightedVps = base?.data.standaloneVps ?? vpsRows.filter(item => item.enabled && item.dashboardEnabled).map(asVpsHighlight);
    const highlightedSignal = base?.data.signalCards ?? signalRows.filter(item => item.enabled && item.dashboardEnabled !== false).map(item => ({
      id: item.id, displayName: item.displayName, description: item.description ?? null, critical: item.critical ?? false,
      displayOrder: item.displayOrder ?? 0, enabled: item.enabled, state: item.state ?? 0, latencyMs: item.latencyMs ?? null,
      readyStatus: item.readyStatus ?? null, workerStatus: item.workerStatus ?? null, activeInstances: item.activeInstances ?? null,
      strip: item.strip ?? [], uptime24h: item.uptime24h ?? null, checkedAt: item.checkedAt ?? null,
    }));
    const probePool = new Map([...highlightedProbes, ...probeCards].map(item => [item.id, item]));
    const vpsPool = new Map([...highlightedVps, ...vpsCards].map(item => [item.id, item]));
    const signalPool = new Map([...highlightedSignal, ...signalCards].map(item => [item.id, item]));
    const resourcePool = new Map(allResources.map(item => [item.id, item]));
    setBlocks(selected.blocks.filter(block => block.enabled).map(block => {
      const source = block.type === "host_inventory" ? hosts : block.type === "container_inventory" ? containers : ["highlighted_resources", "resource_card"].includes(block.type) ? services : base;
      const signalFlow = base?.data.blocks.find(item => item.type === "signal_flow");
      let data: OverviewBlock["data"] = null;
      if (block.type === "summary") data = base?.data.summary ?? null;
      else if (block.type === "asgard_summary") data = base?.data.asgardSummary ?? null;
      else if (block.type === "problems") data = base?.data.problems ?? null;
      else if (block.type === "host_inventory") data = hosts?.data ?? null;
      else if (block.type === "container_inventory") data = containers?.data ?? null;
      else if (block.type === "uptime_list") data = base?.data.uptimeBoard ?? [];
      else if (block.type === "signal_flow") data = signalFlow?.data ?? { target: null };
      else if (block.type === "storage_summary") {
        const target = storages.get(effectiveOptions({ ...block, type: "storage_summary" }).storageConfigId) ?? null;
        return { blockId: block.id, type: block.type, options: block.options, data: { target }, availability: target ? "ready" : "no_data", stale: target?.stale ?? true, lastUpdated: storageResult?.lastUpdated ?? null };
      }
      else if (block.type === "resource_card") data = highlightedResources.find(item => item.id === block.resourceConfigId) ?? null;
      else if (block.type === "highlighted_resources") {
        const options = effectiveOptions({ ...block, type: "highlighted_resources" });
        const panel: AvailabilityPanelData = {
          cards: options.selection === "custom"
            ? buildCustomAvailabilityCards(options.cards, { resources: resourcePool, probes: probePool, vps: vpsPool, signalCards: signalPool, storages })
            : buildDefaultAvailabilityCards(highlightedResources, highlightedProbes, highlightedVps, highlightedSignal, options, storageItems),
        };
        data = panel;
      }
      return { blockId: block.id, type: block.type, options: block.options, data, availability: block.type === "uptime_list" || block.type === "signal_flow" ? "ready" : source?.availability ?? "unavailable", stale: block.type === "uptime_list" || block.type === "signal_flow" ? false : source?.stale ?? true, lastUpdated: source?.lastUpdated ?? null };
    }));
    setFailed(results.some(result => result.status === "rejected")); setLoading(false);
  }, [signature]);
  useEffect(() => { const controller = new AbortController(); const timer = setTimeout(() => { setLoading(true); void read(controller.signal).catch(() => { if (!controller.signal.aborted) { setFailed(true); setLoading(false); } }); }, 250); return () => { clearTimeout(timer); controller.abort(); }; }, [read, reload]);
  useEffect(() => { const element = content.current; if (!element) return; const check = () => setScroll(element.scrollHeight > window.innerHeight - 180); const observer = new ResizeObserver(check); observer.observe(element); window.addEventListener("resize", check); check(); return () => { observer.disconnect(); window.removeEventListener("resize", check); }; }, []);
  const enabled = screen.blocks.filter(block => block.enabled);
  const split = screen.layout === "overview" && screen.overviewGrid === "split";
  const wall = screen.layout === "wall";
  const hasStorage = enabled.some(block => block.type === "storage_summary");
  const gridTypes = new Set(["highlighted_resources", "problems", "asgard_summary", "signal_flow"]);
  const hasProblems = enabled.some(block => block.type === "problems");
  const renderPreviewBlock = (block: Screen["blocks"][number]) => {
    const data = blocks?.find(item => item.blockId === block.id);
    const width = displayBlockWidth(block, enabled, { split, wall });
    return <div key={block.id} className={`dashboard-block width-${width} block-${block.type}`}>{data ? <DashboardBlock block={data} failed={false} /> : <p className="panel-empty">Carregando prévia…</p>}</div>;
  };
  return <section className="admin-preview" aria-label="Prévia da composição"><div className="admin-actions"><h3>Prévia local · não salva · {screen.name}</h3><Button type="button" onClick={() => setReload(value => value + 1)}>Atualizar prévia</Button></div><Field label="Visualização da prévia"><select value={tvPreview ? "tv" : "normal"} onChange={event => setTvPreview(event.target.value === "tv")}><option value="normal">Normal · 100%</option><option value="tv">Telão · {displayScalePercent}%</option></select></Field><p className="admin-muted">Dados reais disponíveis, na largura atual do navegador. As alterações só serão compartilhadas ao salvar.</p>{(scroll || hasStorage && compositionScroll) && <p className="admin-notice">Esta composição precisa de rolagem nesta altura de tela. Reduza linhas/blocos ou distribua o conteúdo entre telas.</p>}{failed && <p role="alert" className="admin-notice">Parte dos dados não pôde ser lida. Os blocos afetados indicam indisponibilidade.</p>}<EvidenceClock><div ref={content} className={`dashboard dashboard-preview ${screen.layout} ${screen.layout === "overview" ? "balanced" : ""} ${tvPreview ? "tv-mode" : ""}`} data-display-scale={scale} style={{ "--dashboard-scale": scale / 100 } as CSSProperties} aria-busy={loading}><div className={`dashboard-blocks${split ? " overview-split" : ""}${hasStorage ? " has-storage" : ""}`}>{hasStorage && <StorageComposition blocks={enabled} split={split} wall={wall} render={renderPreviewBlock} onOverflow={setCompositionScroll} />}{!hasStorage && !split && enabled.map(renderPreviewBlock)}{!hasStorage && split && <>{enabled.filter(block => block.type === "summary").map(renderPreviewBlock)}<div className={`overview-split-grid${hasProblems ? "" : " no-problems"}`}>{enabled.filter(block => block.type === "highlighted_resources").map(renderPreviewBlock)}{enabled.filter(block => block.type === "problems").map(renderPreviewBlock)}{enabled.filter(block => block.type === "asgard_summary").map(renderPreviewBlock)}{enabled.filter(block => block.type === "signal_flow").map(renderPreviewBlock)}</div>{enabled.filter(block => block.type !== "summary" && !gridTypes.has(block.type)).map(renderPreviewBlock)}</>}</div></div></EvidenceClock></section>;
}
