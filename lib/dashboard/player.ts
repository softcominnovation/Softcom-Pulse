import { createStore } from "zustand/vanilla";
import type { PresentationDocument } from "../config/presentation.ts";

export type Screen = PresentationDocument["screens"][number];
export const renderedBlocks = new Set(["summary", "highlighted_resources", "problems", "asgard_summary", "resource_card", "host_inventory", "container_inventory", "uptime_list", "signal_flow"]);
export function playableScreens(document: PresentationDocument | null): Screen[] {
  return document?.screens.filter(screen => screen.enabled && screen.blocks.some(block => block.enabled && renderedBlocks.has(block.type))) ?? [];
}
type Player = {
  document: PresentationDocument | null; pending: PresentationDocument | null; screenId: string | null;
  rotating: boolean; readingPaused: boolean; hidden: boolean; dialog: boolean;
  remaining: number; deadline: number | null; layoutOverride: Screen["layout"] | null; notice: string | null;
};
type Actions = {
  configure: (document: PresentationDocument, now?: number) => void;
  start: (now?: number) => void; stop: () => void; format: (layout: Screen["layout"]) => void;
  select: (id: string) => void; step: (direction: number) => void; pause: () => void;
  block: (reason: "hidden" | "dialog", value: boolean, now?: number) => void; tick: (now?: number) => void;
};
const initial: Player = { document: null, pending: null, screenId: null, rotating: false, readingPaused: false, hidden: false, dialog: false, remaining: 0, deadline: null, layoutOverride: null, notice: null };
export function createPlayerStore() {
  return createStore<Player & Actions>()((set, get) => {
    const duration = (document: PresentationDocument | null) => document?.rotation.intervalSeconds ?? 20;
    function apply(document: PresentationDocument): Partial<Player> {
      const state = get(), screens = playableScreens(document), retained = screens.some(screen => screen.id === state.screenId);
      return { document, pending: null, screenId: retained ? state.screenId : screens[0]?.id ?? null,
        rotating: state.rotating && screens.length > 1, notice: state.screenId && !retained ? "A tela anterior foi removida ou desabilitada. A primeira tela disponível foi selecionada." : null };
    }
    function select(id: string) {
      if (!playableScreens(get().document).some(screen => screen.id === id)) return;
      set({ screenId: id, readingPaused: true, deadline: null, remaining: duration(get().document), layoutOverride: null });
    }
    return { ...initial,
      configure(document, now = Date.now()) {
        const state = get();
        if (document.revision <= Math.max(state.document?.revision ?? 0, state.pending?.revision ?? 0)) return;
        if (!state.document) {
          const rotating = document.rotation.autoStart && playableScreens(document).length > 1;
          set({ ...apply(document), rotating, remaining: duration(document), deadline: rotating && !state.hidden && !state.dialog ? now + duration(document) * 1000 : null });
        } else if (!playableScreens(document).some(screen => screen.id === state.screenId)) {
          const update = apply(document);
          set({ ...update, remaining: duration(document), deadline: update.rotating && !state.readingPaused && !state.hidden && !state.dialog ? now + duration(document) * 1000 : null });
        } else if (state.rotating || state.readingPaused || state.hidden || state.dialog) set({ pending: document });
        else set({ ...apply(document), remaining: duration(document) });
      },
      start(now = Date.now()) {
        if (get().pending) set(apply(get().pending!));
        const state = get();
        if (playableScreens(state.document).length < 2) { set({ readingPaused: false }); return; }
        set({ rotating: true, readingPaused: false, layoutOverride: null, remaining: duration(state.document), deadline: !state.hidden && !state.dialog ? now + duration(state.document) * 1000 : null });
      },
      stop() { set({ rotating: false, readingPaused: false, deadline: null }); if (get().pending) set(apply(get().pending!)); },
      format(layout) { get().stop(); set({ layoutOverride: layout }); },
      select,
      step(direction) {
        const state = get(), screens = playableScreens(state.document);
        if (screens.length) select(screens[(screens.findIndex(screen => screen.id === state.screenId) + direction + screens.length) % screens.length].id);
      },
      pause() { if (get().rotating) set({ readingPaused: true, deadline: null }); },
      block(reason, value, now = Date.now()) {
        if (get()[reason] === value) return;
        const state = get();
        set({ [reason]: value, remaining: state.deadline ? Math.max(0, Math.ceil((state.deadline - now) / 1000)) : state.remaining, deadline: null });
        let next = get();
        if (!next.readingPaused && !next.hidden && !next.dialog) {
          if (next.pending) set(apply(next.pending));
          next = get();
          set({ remaining: duration(next.document), deadline: next.rotating ? now + duration(next.document) * 1000 : null });
        }
      },
      tick(now = Date.now()) {
        const state = get();
        if (!state.rotating || state.readingPaused || state.hidden || state.dialog || state.deadline === null) return;
        const remaining = Math.max(0, Math.ceil((state.deadline - now) / 1000));
        if (remaining) { if (remaining !== state.remaining) set({ remaining }); return; }
        if (state.pending) set(apply(state.pending));
        const next = get(), screens = playableScreens(next.document), index = screens.findIndex(screen => screen.id === next.screenId);
        set({ screenId: screens.length ? screens[(index + 1) % screens.length].id : null, layoutOverride: null,
          remaining: duration(next.document), deadline: next.rotating ? now + duration(next.document) * 1000 : null });
      },
    };
  });
}
