"use client";

import { useCallback, useEffect, useState } from "react";
import { useStore } from "zustand";
import { Activity, RefreshCw, TriangleAlert } from "lucide-react";
import { isAxiosError } from "axios";
import { presentationDocumentSchema, type PresentationDocument } from "@/lib/config/presentation";
import type { Overview, ReadResult } from "@/lib/monitoring/contracts";
import { createPlayerStore, playableScreens } from "@/lib/dashboard/player";
import { timestamp } from "@/lib/dashboard/format";
import { api } from "@/lib/client/api";
import { useUiStore } from "@/store/ui.store";
import { Button } from "@/components/ui/button";
import { DashboardBlock } from "./blocks";
import { DashboardSkeleton } from "./dashboard-skeleton";
import { PlayerToolbar } from "./player-toolbar";
import { shortcutAllowed } from "./display-controls";
import { usePoll } from "./use-poll";
import { useIdlePresentation } from "./use-idle-presentation";
import { EvidenceTimeContext } from "./metrics";

const configurationDelay = () => 60000;
const overviewDelay = (result: ReadResult<Overview>) => result.refreshAfterMs;
function hasOldEvidence(value: unknown, now: number): boolean {
  if (!value || typeof value !== "object") return false;
  if ("quality" in value && value.quality === "stale") return true;
  if ("validUntil" in value && typeof value.validUntil === "string" && Date.parse(value.validUntil) < now) return true;
  return Object.values(value).some(child => typeof child === "object" && hasOldEvidence(child, now));
}
export function Dashboard() {
  const [store] = useState(createPlayerStore), player = useStore(store);
  const [now, setNow] = useState(0);
  const loadConfiguration = useCallback(async (signal: AbortSignal) => {
    const response = await api.get("/settings/presentation", { signal });
    const document = presentationDocumentSchema.parse(response.data.data);
    if (signal.aborted) return document;
    if (!store.getState().document) useUiStore.getState().setTvMode(document.defaultTvMode);
    store.getState().configure(document);
    return document;
  }, [store]);
  useEffect(() => {
    if (player.document) useUiStore.getState().setDisplayScalePercent(player.document.displayScalePercent);
  }, [player.document]);
  const configuration = usePoll<PresentationDocument>("presentation", loadConfiguration, configurationDelay, "Não foi possível atualizar as configurações do dashboard.");
  const refreshConfiguration = configuration.refresh;
  const screen = playableScreens(player.document).find(item => item.id === player.screenId);
  useIdlePresentation(screen ? player.document?.idlePresentation : undefined);
  const revision = player.document?.revision;
  const loadOverview = useCallback(async (signal: AbortSignal) => {
    const response = await api.get<ReadResult<Overview>>("/dashboard/overview", { params: { screenId: player.screenId }, signal }).catch(error => {
      if (isAxiosError(error) && error.response?.status === 404) refreshConfiguration();
      throw error;
    });
    const result = response.data;
    if (!result?.data || result.data.screenId !== player.screenId || !Array.isArray(result.data.blocks) || !Number.isFinite(result.refreshAfterMs)) throw new Error("Invalid overview");
    if (result.data.presentationRevision !== revision) { refreshConfiguration(); throw new Error("Presentation changed"); }
    return result;
  }, [player.screenId, revision, refreshConfiguration]);
  const overview = usePoll(screen ? `${screen.id}:${revision}` : null, loadOverview, overviewDelay, "Não foi possível atualizar os dados. A última leitura permanece identificada na tela.");
  useEffect(() => {
    const visibility = () => store.getState().block("hidden", document.hidden);
    const dialog = () => store.getState().block("dialog", !!document.querySelector('[role="dialog"][data-state="open"], dialog[open]'));
    const reading = (event: Event) => {
      if (event.target instanceof Element && event.target.closest("[data-dashboard-content]")) store.getState().pause();
      else if (event.type === "scroll" && (event.target === document || event.target === document.documentElement)) store.getState().pause();
    };
    const key = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() === "r" && shortcutAllowed(event)) {
        event.preventDefault(); const state = store.getState(); if (state.rotating) state.stop(); else state.start();
      }
    };
    visibility(); dialog();
    const observer = new MutationObserver(dialog);
    observer.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ["open", "data-state", "role"] });
    const tick = setInterval(() => { store.getState().tick(); setNow(Date.now()); }, 1000);
    document.addEventListener("visibilitychange", visibility); document.addEventListener("keydown", key);
    for (const event of ["scroll", "touchstart", "focusin", "wheel"]) document.addEventListener(event, reading, { capture: true, passive: true });
    return () => {
      clearInterval(tick); observer.disconnect(); document.removeEventListener("visibilitychange", visibility); document.removeEventListener("keydown", key);
      for (const event of ["scroll", "touchstart", "focusin", "wheel"]) document.removeEventListener(event, reading, true);
    };
  }, [store]);
  const result = overview.data, stale = !!result?.stale || overview.failed;
  const showStatusBanner = player.document?.showStatusBanner === true;
  const partial = showStatusBanner && !!result && hasOldEvidence(result.data, now);
  const problems = result?.data.summary.problems;
  const hasData = result?.availability === "ready";
  const tone = stale ? "warn" : !hasData ? "unknown" : (result?.data.summary.criticalAffected ?? 0) > 0 ? "bad" : (problems ?? 0) > 0 ? "warn" : "unknown";
  const title = overview.failed ? "Falha na atualização" : result?.stale ? "Dados desatualizados" : !result ? "Carregando monitoramento" : !hasData ? "Aguardando dados do monitoramento" : partial ? "Há evidências desatualizadas" : (problems ?? 0) > 0 ? "A operação requer atenção" : "Monitoramento atualizado";
  const layout = player.layoutOverride ?? screen?.layout ?? "overview";
  return <div className={`dashboard ${layout} ${layout === "overview" ? "balanced" : ""}`}>
    <PlayerToolbar store={store} />
    {configuration.failed && <div className="dashboard-banner banner-warn" role="alert"><TriangleAlert aria-hidden="true" /><div><strong>Não foi possível carregar a configuração</strong><p>{player.document ? "A última configuração válida foi mantida." : "Tente novamente para carregar as telas salvas."}</p></div><Button onClick={configuration.refresh}>Tentar novamente</Button></div>}
    {!player.document && !configuration.failed && <DashboardSkeleton label="Carregando as telas configuradas…" />}
    {player.document && !screen && <div className="dashboard-banner banner-warn" role="alert"><TriangleAlert aria-hidden="true" /><div><strong>Nenhuma composição utilizável</strong><p>A configuração precisa de uma tela habilitada com blocos disponíveis.</p></div><Button onClick={configuration.refresh}>Recarregar configuração</Button></div>}
    {screen && <>
      {showStatusBanner && <div className={`dashboard-banner dashboard-status-banner banner-${tone}`} role={overview.failed || result?.stale ? "alert" : "status"}>
        {tone === "warn" || tone === "bad" ? <TriangleAlert aria-hidden="true" /> : <Activity aria-hidden="true" />}
        <div><strong>{title}</strong><p>{overview.failed ? result ? "A última leitura foi mantida. Os valores não representam confirmação do estado atual." : "Ainda não foi possível obter uma leitura. Tente novamente." : result?.presentationStatus === "unavailable" ? "Nomes personalizados indisponíveis; identificações técnicas preservadas." : partial ? "Confira a data e a qualidade de cada amostra." : !hasData ? "Os indicadores serão exibidos quando houver evidência disponível." : "Dados do Zabbix · estado e qualidade avaliados por recurso."}</p></div>
        <div className="banner-update"><span>Última atualização</span><time dateTime={result?.lastUpdated ?? undefined}>{timestamp(result?.lastUpdated)}</time></div>
        <Button size="icon" aria-label="Atualizar monitoramento" title={`Última atualização: ${timestamp(result?.lastUpdated)}`} onClick={overview.refresh}><RefreshCw aria-hidden="true" /></Button>
      </div>}
      <EvidenceTimeContext value={now}>{(() => {
        const enabled = screen.blocks.filter(block => block.enabled);
        const split = layout === "overview" && screen.overviewGrid === "split";
        const renderBlock = (block: typeof enabled[number]) => {
          const payload = result?.data.blocks.find(item => item.blockId === block.id && item.type === block.type);
          return <div className={`dashboard-block width-${block.width} block-${block.type}`} key={block.id}>
            {payload ? <DashboardBlock block={payload} failed={stale} probes={result?.data.externalServices ?? []} vps={result?.data.standaloneVps ?? []} signalCards={result?.data.signalCards ?? []} hostMetricsSources={result?.data.hostMetricsSources} /> : result ? <section className="dashboard-panel"><p className="panel-empty">Bloco sem dados na resposta atual.</p></section> : null}
          </div>;
        };
        return <div data-dashboard-content className={`dashboard-blocks${split ? " overview-split" : ""}`} aria-busy={overview.loading}>
          {!result && !overview.failed && <DashboardSkeleton label="Carregando os indicadores da tela…" />}
          {result && !split && enabled.map(renderBlock)}
          {result && split && (() => {
            const gridTypes = new Set(["highlighted_resources", "problems", "asgard_summary", "signal_flow"]);
            const byType = (type: string) => enabled.filter(block => block.type === type);
            const hasProblems = byType("problems").length > 0;
            return <>
              {byType("summary").map(renderBlock)}
              <div className={`overview-split-grid${hasProblems ? "" : " no-problems"}`}>
                {byType("highlighted_resources").map(renderBlock)}
                {byType("problems").map(renderBlock)}
                {byType("asgard_summary").map(renderBlock)}
                {byType("signal_flow").map(renderBlock)}
              </div>
              {enabled.filter(block => !gridTypes.has(block.type) && block.type !== "summary").map(renderBlock)}
            </>;
          })()}
        </div>;
      })()}</EvidenceTimeContext>
    </>}
    <footer className="dashboard-footer"><div aria-label="Legenda de estados"><span className="tone-good"><i className="status-dot" />Disponível</span><span className="tone-warn"><i className="status-dot" />Atenção</span><span className="tone-bad"><i className="status-dot" />Indisponível</span><span><i className="status-dot" />Desconhecido / sem dados</span></div><p>Horários de Fortaleza · UTC−3{result && <> · Atualização a cada {Math.round(result.refreshAfterMs / 1000)}s</>}</p></footer>
  </div>;
}
