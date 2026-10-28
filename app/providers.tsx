"use client";

import { DirectionProvider } from "@base-ui/react/direction-provider";
import {
  createContext,
  useContext,
  useEffect,
  useRef,
  type ReactNode,
} from "react";
import { Toaster } from "sonner";
import { AuthRuntime } from "@/components/auth/auth-runtime";
import { SoundEffects } from "@/components/ui/sound";
import { NotificationProvider } from "@/components/notifications/provider";
import { Toasts } from "@/components/ui/toast";
import { TooltipProvider } from "@/components/ui/tooltip";
import { InstanceInventoryProvider } from "@/components/whatsapp/whatsapp-instances";
import type { PublicConfig } from "@/lib/public-config";
import {
  THEME_STORAGE_KEY,
  type PulseTheme,
  useUiStore,
} from "@/store/ui.store";

const PublicConfigContext = createContext<PublicConfig | null>(null);

export function usePublicConfig() {
  const config = useContext(PublicConfigContext);
  if (!config) throw new Error("Public configuration provider is missing.");
  return config;
}

function readInitialTheme(): PulseTheme | null {
  if (typeof window === "undefined") return null;
  const queryTheme = new URLSearchParams(window.location.search).get("theme");
  if (queryTheme === "dark" || queryTheme === "light") return queryTheme;
  try {
    const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
    if (stored === "dark" || stored === "light") return stored;
  } catch {
    // Ignore storage access errors
  }
  return null;
}

export function Providers({
  children,
  config,
}: {
  children: ReactNode;
  config?: PublicConfig;
}) {
  const theme = useUiStore((state) => state.theme);
  const setTheme = useUiStore((state) => state.setTheme);
  const hydratedRef = useRef(false);

  useEffect(() => {
    const initial = readInitialTheme();
    if (initial) {
      setTheme(initial);
    }
    hydratedRef.current = true;
  }, [setTheme]);

  useEffect(() => {
    if (typeof document === "undefined") return;
    const style = document.createElement("style");
    style.appendChild(
      document.createTextNode(
        "*, *::before, *::after { transition: none !important; animation: none !important; }"
      )
    );
    document.head.appendChild(style);
    document.documentElement.classList.toggle("dark", theme === "dark");
    document.documentElement.dataset.theme = theme;
    void window.getComputedStyle(document.documentElement).opacity;
    document.head.removeChild(style);
    if (hydratedRef.current) {
      try {
        window.localStorage.setItem(THEME_STORAGE_KEY, theme);
      } catch {
        // Ignore storage write errors
      }
    }
  }, [theme]);

  const fallbackConfig: PublicConfig = config ?? {
    appName: "Softcom Pulse",
    softcomUrl: "https://softcomtecnologia.com.br",
  };

  return (
    <PublicConfigContext.Provider value={fallbackConfig}>
      <DirectionProvider direction="ltr">
        <SoundEffects>
          <TooltipProvider delay={180}>
            <InstanceInventoryProvider>
              <AuthRuntime />
              <NotificationProvider>{children}</NotificationProvider>
              <Toasts position="bottom-end" />
              <Toaster
                theme={theme}
                position="bottom-right"
                toastOptions={{ className: "pulse-toast" }}
              />
            </InstanceInventoryProvider>
          </TooltipProvider>
        </SoundEffects>
      </DirectionProvider>
    </PublicConfigContext.Provider>
  );
}
