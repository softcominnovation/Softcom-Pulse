"use client";

import { useStore } from "zustand";
import { AuthController } from "@/lib/client/auth-session";
import { authHttp } from "@/lib/client/auth-http";
import { STORAGE_KEY, REFRESH_LOCK, STORAGE_LOCK } from "@/lib/auth/contracts";
import { useUiStore } from "@/store/ui.store";

let controller: AuthController | undefined;
export function getAuthController() {
  controller ??= new AuthController({
    read: () => localStorage.getItem(STORAGE_KEY),
    write: value => localStorage.setItem(STORAGE_KEY, value),
    id: () => crypto.randomUUID(),
    lock: typeof navigator !== "undefined" && navigator.locks
      ? async run => await navigator.locks.request(REFRESH_LOCK, run) : undefined,
    transaction: typeof navigator !== "undefined" && navigator.locks
      ? async run => await navigator.locks.request(STORAGE_LOCK, run) : undefined,
    reset: () => useUiStore.setState({ tvMode: false, isFullscreen: false }),
    transport: {
      login: async (input, signal) => (await authHttp.post("/login", input, { signal })).data,
      refresh: async (refreshToken, signal) => (await authHttp.post("/refresh", { refreshToken }, { signal })).data,
      session: async (token, signal) => (await authHttp.get("/session", { signal, headers: { Authorization: "Bearer " + token } })).data,
      logout: async refreshToken => (await authHttp.post("/logout", { refreshToken })).data,
    },
  });
  return controller;
}
export function useAuthStore() {
  return useStore(getAuthController().store);
}
export function useCanEdit() {
  return useStore(getAuthController().store, state => state.editor);
}
