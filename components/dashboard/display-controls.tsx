"use client";

import { useCallback, useEffect } from "react";
import { Maximize2, Minimize2, Tv } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { enterFullscreen } from "@/lib/client/fullscreen";
import { useUiStore } from "@/store/ui.store";

export function shortcutAllowed(event: KeyboardEvent) {
  return !event.repeat && !event.ctrlKey && !event.altKey && !event.metaKey && !event.shiftKey
    && !(event.target instanceof Element && event.target.closest("input, textarea, select, [contenteditable]:not([contenteditable=false]), [role=dialog], dialog"))
    && !document.querySelector('[role="dialog"][data-state="open"], dialog[open]');
}
export function DisplayControls() {
  const { tvMode, isFullscreen, setTvMode, setFullscreen } = useUiStore();
  const fullscreen = useCallback(async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await enterFullscreen();
    } catch { toast.info("Tela cheia indisponível neste navegador. O modo TV e a alternância continuam disponíveis."); }
  }, []);
  useEffect(() => {
    const update = () => setFullscreen(!!document.fullscreenElement);
    const key = (event: KeyboardEvent) => {
      if (!shortcutAllowed(event)) return;
      if (event.key.toLowerCase() === "f") { event.preventDefault(); void fullscreen(); }
      if (event.key.toLowerCase() === "t") { event.preventDefault(); setTvMode(!useUiStore.getState().tvMode); }
    };
    update(); document.addEventListener("fullscreenchange", update); document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("fullscreenchange", update); document.removeEventListener("keydown", key); setTvMode(false); setFullscreen(false);
      if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
    };
  }, [fullscreen, setFullscreen, setTvMode]);
  return <>
    <Button aria-pressed={tvMode} className={tvMode ? "display-active" : ""} onClick={() => setTvMode(!tvMode)} title="Atalho T"><Tv aria-hidden="true" />{tvMode ? "Sair do modo TV" : "Modo TV"}</Button>
    <Button aria-pressed={isFullscreen} onClick={() => { void fullscreen(); }} title="Atalho F">{isFullscreen ? <Minimize2 aria-hidden="true" /> : <Maximize2 aria-hidden="true" />}{isFullscreen ? "Sair da tela cheia" : "Tela cheia"}</Button>
  </>;
}
