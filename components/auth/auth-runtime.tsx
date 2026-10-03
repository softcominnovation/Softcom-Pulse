"use client";

import { useEffect } from "react";
import { getAuthController, useAuthStore } from "@/store/auth.store";
import { STORAGE_KEY, REFRESH_SKEW_MS } from "@/lib/auth/contracts";

export function AuthRuntime() {
  const { session, status } = useAuthStore();
  useEffect(() => {
    const auth = getAuthController();
    void auth.initialize();
    const sync = (event: StorageEvent) => { if (event.key === STORAGE_KEY || event.key === null) void auth.sync(); };
    const resume = () => { if (!document.hidden) void auth.sync().then(() => auth.store.getState().session && auth.validate()); };
    window.addEventListener("storage", sync);
    window.addEventListener("online", resume);
    document.addEventListener("visibilitychange", resume);
    return () => {
      window.removeEventListener("storage", sync);
      window.removeEventListener("online", resume);
      document.removeEventListener("visibilitychange", resume);
    };
  }, []);
  useEffect(() => {
    if (!session || status !== "authenticated") return;
    const timeout = setTimeout(() => { void getAuthController().validate(); }, Math.max(1000, session.expiresAt - Date.now() - REFRESH_SKEW_MS));
    const expiry = setTimeout(() => {
      const auth = getAuthController();
      if (auth.store.getState().session?.accessToken === session.accessToken) auth.store.setState({ status: "loading" });
    }, Math.max(0, session.expiresAt - Date.now()));
    return () => { clearTimeout(timeout); clearTimeout(expiry); };
  }, [session, status]);
  return null;
}
