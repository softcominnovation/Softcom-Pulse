"use client";

import { create } from "zustand";
import { defaultDisplayScalePercent, type DisplayScalePercent } from "@/lib/config/presentation";

type UiState = {
  tvMode: boolean;
  isFullscreen: boolean;
  displayScalePercent: DisplayScalePercent;
  setDisplayScalePercent: (value: DisplayScalePercent) => void;
  setTvMode: (enabled: boolean) => void;
  setFullscreen: (enabled: boolean) => void;
};

export const useUiStore = create<UiState>((set) => ({
  tvMode: false,
  isFullscreen: false,
  displayScalePercent: defaultDisplayScalePercent,
  setDisplayScalePercent: (displayScalePercent) => set({ displayScalePercent }),
  setTvMode: (tvMode) => set({ tvMode }),
  setFullscreen: (isFullscreen) => set({ isFullscreen }),
}));
