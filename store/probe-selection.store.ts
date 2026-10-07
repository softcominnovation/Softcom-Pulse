"use client";

import { create } from "zustand";

type ProbeSelectionState = {
  serviceId: string | null;
  select: (serviceId: string) => void;
  consume: () => void;
};

export const useProbeSelectionStore = create<ProbeSelectionState>(set => ({
  serviceId: null,
  select: serviceId => set({ serviceId }),
  consume: () => set({ serviceId: null }),
}));
