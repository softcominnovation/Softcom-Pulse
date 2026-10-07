"use client";

import { create } from "zustand";

type VpsSelectionState = {
  vpsId: string | null;
  select: (vpsId: string) => void;
  consume: () => void;
};

export const useVpsSelectionStore = create<VpsSelectionState>(set => ({
  vpsId: null,
  select: vpsId => set({ vpsId }),
  consume: () => set({ vpsId: null }),
}));
