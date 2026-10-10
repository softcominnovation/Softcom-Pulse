"use client";

import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import { api } from "@/lib/client/api";
import type { DisplayScalePercent, PresentationSettings } from "@/lib/config/presentation";
import type { Overview, OverviewBlock, ReadResult } from "@/lib/monitoring/contracts";
import { hostSchema, containerSchema, configuredResourceSchema } from "@/lib/monitoring/contracts";
import { readSchema, EvidenceClock } from "@/components/infrastructure/data";
import { DashboardBlock } from "@/components/dashboard/blocks";
import { Button } from "@/components/ui/button";
import { Field } from "./shared";

type Screen = PresentationSettings["screens"][number];
export function PresentationPreview({ screen, displayScalePercent }: { screen: Screen; displayScalePercent: DisplayScalePercent }) {
  const [tvPreview, setTvPreview] = useState(true);
  const scale = tvPreview ? displayScalePercent : 100;
  const [blocks, setBlocks] = useState<OverviewBlock[] | null>(null), [probes, setProbes] = useState<Overview["externalServices"]>([]), [vps, setVps] = useState<Overview["standaloneVps"]>([]), [signalCards, setSignalCards] = useState<Overview["signalCards"]>([]), [failed, setFailed] = useState(false), [scroll, setScroll] = useState(false), [loading, setLoading] = useState(false);
  const content = useRef<HTMLDivElement>(null), [reload, setReload] = useState(0);
  const signature = JSON.stringify(screen);
  const read = useCallback(async (signal: AbortSignal) => {
    const results = await Promise.allSettled([
      api.get<ReadResult<Overview>>("/dashboard/overview", { signal }).then(response => response.data),
      api.get("/monitoring/hosts", { signal }).then(response => readSchema(hostSchema.array()).parse(response.data)),
      api.get("/monitoring/containers", { signal }).then(response => readSchema(containerSchema.array()).parse(response.data)),
      api.get("/monitoring/services", { signal }).then(response => readSchema(configuredResourceSchema.array()).parse(response.data)),
    ]);
    if (signal.aborted) return;
    const base = results[0].status === "fulfilled" ? results[0].value : null;
    const hosts = results[1].status === "fulfilled" ? results[1].value : null;
    const containers = results[2].status === "fulfilled" ? results[2].value : null;
    const services = results[3].status === "fulfilled" ? results[3].value : null;
    const selected = JSON.parse(signature) as Screen;
    setBlocks(selected.blocks.filter(block => block.enabled).map(block => {
      const source = block.type === "host_inventory" ? hosts : block.type === "container_inventory" ? containers : ["highlighted_resources", "resource_card"].includes(block.type) ? services : base;
      const resources = services?.data.filter(item => item.config.enabled && item.config.dashboardEnabled) ?? [];
      const signalFlow = base?.data.blocks.find(item => item.type === "signal_flow");
      const data = block.type === "summary" ? base?.data.summary : block.type === "asgard_summary" ? base?.data.asgardSummary : block.type === "problems" ? base?.data.problems : block.type === "host_inventory" ? hosts?.data : block.type === "container_inventory" ? containers?.data : block.type === "highlighted_resources" ? resources : block.type === "uptime_list" ? (base?.data.uptimeBoard ?? []) : block.type === "signal_flow" ? (signalFlow?.data ?? { target: null }) : resources.find(item => item.id === block.resourceConfigId);
      return { blockId: block.id, type: block.type, options: block.options, data: data ?? null, availability: block.type === "uptime_list" || block.type === "signal_flow" ? "ready" : source?.availability ?? "unavailable", stale: block.type === "uptime_list" || block.type === "signal_flow" ? false : source?.stale ?? true, lastUpdated: source?.lastUpdated ?? null };
    }));
    setProbes(base?.data.externalServices ?? []);
    setVps(base?.data.standaloneVps ?? []);
    setSignalCards(base?.data.signalCards ?? []);
    setFailed(results.some(result => result.status === "rejected")); setLoading(false);
  }, [signature]);
  useEffect(() => { const controller = new AbortController(); const timer = setTimeout(() => { setLoading(true); void read(controller.signal).catch(() => { if (!controller.signal.aborted) { setFailed(true); setLoading(false); } }); }, 250); return () => { clearTimeout(timer); controller.abort(); }; }, [read, reload]);
  useEffect(() => { const element = content.current; if (!element) return; const check = () => setScroll(element.scrollHeight > window.innerHeight - 180); const observer = new ResizeObserver(check); observer.observe(element); window.addEventListener("resize", check); check(); return () => { observer.disconnect(); window.removeEventListener("resize", check); }; }, []);
  return <section className="admin-preview" aria-label="Prévia da composição"><div className="admin-actions"><h3>Prévia local · não salva · {screen.name}</h3><Button type="button" onClick={() => setReload(value => value + 1)}>Atualizar prévia</Button></div><Field label="Visualização da prévia"><select value={tvPreview ? "tv" : "normal"} onChange={event => setTvPreview(event.target.value === "tv")}><option value="normal">Normal · 100%</option><option value="tv">Telão · {displayScalePercent}%</option></select></Field><p className="admin-muted">Dados reais disponíveis, na largura atual do navegador. As alterações só serão compartilhadas ao salvar.</p>{scroll && <p className="admin-notice">Esta composição precisa de rolagem nesta altura de tela. Reduza linhas/blocos ou distribua o conteúdo entre telas.</p>}{failed && <p role="alert" className="admin-notice">Parte dos dados não pôde ser lida. Os blocos afetados indicam indisponibilidade.</p>}<EvidenceClock><div ref={content} className={`dashboard dashboard-preview ${screen.layout} ${tvPreview ? "tv-mode" : ""}`} data-display-scale={scale} style={{ "--dashboard-scale": scale / 100 } as CSSProperties} aria-busy={loading}><div className="dashboard-blocks">{screen.blocks.filter(block => block.enabled).map(block => { const data = blocks?.find(item => item.blockId === block.id); return <div key={block.id} className={`dashboard-block width-${block.width} block-${block.type}`}>{data ? <DashboardBlock block={data} failed={false} probes={probes ?? []} vps={vps ?? []} signalCards={signalCards ?? []} /> : <p className="panel-empty">Carregando prévia…</p>}</div>; })}</div></div></EvidenceClock></section>;
}
