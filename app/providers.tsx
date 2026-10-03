"use client";

import { createContext, useContext, type ReactNode } from "react";
import { Toaster } from "sonner";
import type { PublicConfig } from "@/lib/public-config";
import { AuthRuntime } from "@/components/auth/auth-runtime";

const PublicConfigContext = createContext<PublicConfig | null>(null);

export function usePublicConfig() {
  const config = useContext(PublicConfigContext);
  if (!config) throw new Error("Public configuration provider is missing.");
  return config;
}

export function Providers({ children, config }: { children: ReactNode; config: PublicConfig }) {
  return (
    <PublicConfigContext.Provider value={config}>
      <AuthRuntime />
      {children}
      <Toaster theme="dark" position="bottom-right" toastOptions={{ className: "pulse-toast" }} />
    </PublicConfigContext.Provider>
  );
}
