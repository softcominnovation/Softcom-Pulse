"use client";

import { useEffect } from "react";
import { toast } from "sonner";
import type { IdlePresentation } from "@/lib/config/presentation";
import { enterFullscreen } from "@/lib/client/fullscreen";
import { useUiStore } from "@/store/ui.store";

export function useIdlePresentation(settings: IdlePresentation | undefined) {
  const enabled = settings?.enabled, afterMinutes = settings?.afterMinutes, requestFullscreen = settings?.requestFullscreen;
  useEffect(() => {
    if (!enabled || !afterMinutes) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let disposed = false, consumed = false;
    let notice: string | number | undefined;
    const dialogOpen = () => !!document.querySelector('[role="dialog"][data-state="open"], [role="alertdialog"][data-state="open"], dialog[open]');
    let blocked = document.hidden || dialogOpen();
    const dismiss = () => { if (notice !== undefined) toast.dismiss(notice); notice = undefined; };
    const fullscreen = async (automatic: boolean) => {
      try {
        await enterFullscreen();
        if (disposed && document.fullscreenElement) await document.exitFullscreen();
        dismiss();
      } catch {
        if (disposed || !useUiStore.getState().tvMode) return;
        if (automatic) notice = toast.info("Modo TV ativado por inatividade", {
          description: "A entrada automática em tela cheia não foi permitida. Use o botão para tentar com um clique.",
          duration: Infinity,
          closeButton: true,
          action: { label: "Entrar em tela cheia", onClick: () => { void fullscreen(false); } },
        });
        else toast.info("Tela cheia indisponível neste navegador. O modo TV continua ativo.");
      }
    };
    const activate = () => {
      timer = undefined;
      if (disposed || consumed || document.hidden || dialogOpen()) return;
      consumed = true;
      useUiStore.getState().setTvMode(true);
      if (requestFullscreen) void fullscreen(true);
    };
    const schedule = () => {
      clearTimeout(timer);
      timer = !blocked && !consumed ? setTimeout(activate, afterMinutes * 60000) : undefined;
    };
    const activity = () => schedule();
    const suspension = () => {
      const next = document.hidden || dialogOpen();
      if (next === blocked) return;
      blocked = next; schedule();
    };
    const unsubscribe = useUiStore.subscribe((state, previous) => {
      if (previous.tvMode && !state.tvMode || previous.isFullscreen && !state.isFullscreen) {
        consumed = false; dismiss(); schedule();
      } else if (state.isFullscreen) dismiss();
    });
    const observer = new MutationObserver(suspension);
    observer.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ["open", "data-state", "role"] });
    const events = ["pointermove", "pointerdown", "keydown", "wheel", "touchstart", "touchmove", "scroll", "focusin"];
    for (const event of events) document.addEventListener(event, activity, { capture: true, passive: true });
    document.addEventListener("visibilitychange", suspension);
    schedule();
    return () => {
      disposed = true; clearTimeout(timer); dismiss(); unsubscribe(); observer.disconnect();
      for (const event of events) document.removeEventListener(event, activity, true);
      document.removeEventListener("visibilitychange", suspension);
    };
  }, [enabled, afterMinutes, requestFullscreen]);
}
