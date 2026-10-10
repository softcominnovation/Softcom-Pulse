"use client";

import { ChevronLeft, ChevronRight, Play, RefreshCw, Pause } from "lucide-react";
import { useStore } from "zustand";
import { MonitoringNav } from "@/components/layout/monitoring-nav";
import { Button } from "@/components/ui/button";
import { createPlayerStore, playableScreens } from "@/lib/dashboard/player";

export function PlayerToolbar({ store }: { store: ReturnType<typeof createPlayerStore> }) {
  const player = useStore(store), screens = playableScreens(player.document);
  const current = screens.find(screen => screen.id === player.screenId), layout = player.layoutOverride ?? current?.layout;
  const paused = player.readingPaused || player.hidden || player.dialog;
  const canRotate = screens.length > 1;
  return <div className="dashboard-toolbar">
    <div className="dashboard-nav">
      <MonitoringNav />
      <div className="display-options" role="group" aria-label="Formato da TV">
        <span>FORMATO DA TV</span>
        <Button aria-pressed={!player.rotating && layout === "overview"} onClick={() => player.format("overview")}>1 · Visão geral</Button>
        <Button aria-pressed={!player.rotating && layout === "wall"} onClick={() => player.format("wall")}>2 · Tela completa</Button>
        <Button disabled={!canRotate} aria-describedby={!canRotate ? "rotation-reason" : undefined} aria-pressed={player.rotating} onClick={() => player.start()}>3 · Alternância</Button>
      </div>
    </div>
    <div className="dashboard-heading">
      <div><h1>Toda a operação. Um só lugar.</h1><p className="dashboard-subtitle">Infraestrutura, serviços e evidências da operação.</p></div>
      {(player.rotating && paused || !player.rotating && player.pending) && <div className="player-controls">
        {player.rotating && paused && <Button onClick={() => player.start()} disabled={player.hidden || player.dialog}><Play aria-hidden="true" />Continuar alternância</Button>}
        {!player.rotating && player.pending && <Button onClick={() => player.stop()}>Aplicar configuração atualizada</Button>}
      </div>}
    </div>
    <div className="screen-controls">
      <Button variant="ghost" disabled={!canRotate} aria-pressed={player.rotating} title="Atalho R" onClick={() => player.rotating ? player.stop() : player.start()}>{player.rotating ? <Pause aria-hidden="true" /> : <RefreshCw aria-hidden="true" />}{player.rotating ? "Parar alternância" : "Alternar telas"}</Button>
      <label htmlFor="dashboard-screen">Tela {current ? screens.indexOf(current) + 1 : 0} de {screens.length}</label>
      <select id="dashboard-screen" value={player.screenId ?? ""} disabled={!current} onChange={event => player.select(event.target.value)} aria-label="Escolher tela">
        {!current && <option value="">Nenhuma tela disponível</option>}
        {screens.map(screen => <option key={screen.id} value={screen.id}>{screen.name}</option>)}
      </select>
      <Button size="icon" aria-label="Tela anterior" disabled={!canRotate} onClick={() => player.step(-1)}><ChevronLeft aria-hidden="true" /></Button>
      <Button size="icon" aria-label="Próxima tela" disabled={!canRotate} onClick={() => player.step(1)}><ChevronRight aria-hidden="true" /></Button>
      <p className="player-status">{player.rotating ? paused ? "Alternância pausada para leitura" : `Próxima tela em ${player.remaining}s` : "Exibição estática"}</p>
      {!canRotate && <p id="rotation-reason">A alternância requer pelo menos duas telas habilitadas.</p>}
    </div>
    {player.pending && <p className="configuration-notice" role="status">Configuração atualizada. {!player.rotating ? "Use Aplicar configuração atualizada para carregar a nova versão." : paused ? "Será aplicada ao continuar a alternância." : "Será aplicada na próxima troca de tela."}</p>}
    {player.notice && <p className="configuration-notice" role="status">{player.notice}</p>}
  </div>;
}
