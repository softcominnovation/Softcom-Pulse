"use client";

import { create } from "zustand";

type UiState = {
  tvMode: boolean;
  isFullscreen: boolean;
  setTvMode: (enabled: boolean) => void;
  setFullscreen: (enabled: boolean) => void;
};

export const useUiStore = create<UiState>((set) => ({
  tvMode: false,
  isFullscreen: false,
  setTvMode: (tvMode) => set({ tvMode }),
  setFullscreen: (isFullscreen) => set({ isFullscreen }),
}));
