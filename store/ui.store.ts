"use client";

import { create } from "zustand";
import {
  defaultDisplayScalePercent,
  type DisplayScalePercent,
} from "@/lib/config/presentation";

export type PulseTheme = "light" | "dark";

export const THEME_STORAGE_KEY = "softcom-pulse-theme";

type UiState = {
  tvMode: boolean;
  isFullscreen: boolean;
  displayScalePercent: DisplayScalePercent;
  theme: PulseTheme;
  soundSettingsOpen: boolean;
  setDisplayScalePercent: (value: DisplayScalePercent) => void;
  setTvMode: (enabled: boolean) => void;
  setFullscreen: (enabled: boolean) => void;
  setTheme: (theme: PulseTheme) => void;
  toggleTheme: () => void;
  setSoundSettingsOpen: (open: boolean) => void;
};

export const useUiStore = create<UiState>((set) => ({
  tvMode: false,
  isFullscreen: false,
  displayScalePercent: defaultDisplayScalePercent,
  theme: "dark",
  soundSettingsOpen: false,
  setDisplayScalePercent: (displayScalePercent) => set({ displayScalePercent }),
  setTvMode: (tvMode) => set({ tvMode }),
  setFullscreen: (isFullscreen) => set({ isFullscreen }),
  setTheme: (theme) => set({ theme }),
  toggleTheme: () =>
    set((state) => ({ theme: state.theme === "dark" ? "light" : "dark" })),
  setSoundSettingsOpen: (soundSettingsOpen) => set({ soundSettingsOpen }),
}));
