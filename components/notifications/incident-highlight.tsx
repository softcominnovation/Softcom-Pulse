"use client";

import { createContext, useContext } from "react";
import type { AvailabilityCardKind } from "@/lib/config/availability-card-refs";
import type { HighlightedIncident, NotificationChangeView } from "@/lib/notifications/contracts";

export type IncidentStates = Record<string, "error" | "recovered">;
export const IncidentContext = createContext<IncidentStates>({});

declare global {
  interface Window {
    PulseIncidentHighlights: {
      create: (paint: (states: IncidentStates) => void, wasVisible: (ref: string) => boolean) => {
        replace: (rows: HighlightedIncident[]) => void;
        apply: (changes: NotificationChangeView[], serverTime: number, maxAge: number) => void;
        dispose: () => void;
      };
      wasVisible: (ref: string) => boolean;
    };
  }
}

export function useIncidentAttributes() {
  const states = useContext(IncidentContext);
  return (kind: AvailabilityCardKind, id?: string | null) => {
    if (!id) return {};
    const ref = `${kind}:${id}`, state = states[ref];
    return {
      "data-incident-target": ref,
      "data-incident-state": state,
      "aria-description": state === "error" ? "Erro de monitoramento ativo" : state === "recovered" ? "Recuperação confirmada" : undefined,
    };
  };
}
