"use client";

import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import Link from "next/link";
import { LogOut } from "lucide-react";
import { toast } from "sonner";
import { AuthGate } from "@/components/auth/auth-gate";
import { Brand } from "@/components/brand";
import { Button } from "@/components/ui/button";
import { getAuthController, useAuthStore } from "@/store/auth.store";
import { useUiStore } from "@/store/ui.store";
import { DisplayControls } from "@/components/dashboard/display-controls";
import { MonitoringNav } from "./monitoring-nav";

const formatter = new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Fortaleza", hour: "2-digit", minute: "2-digit", second: "2-digit" });
function Clock() {
  const [time, setTime] = useState("--:--:--");
  useEffect(() => {
    const update = () => setTime(formatter.format(new Date()));
    update();
    const interval = setInterval(update, 1000);
    return () => clearInterval(interval);
  }, []);
  return <div className="text-right"><p className="font-mono text-[22px] tracking-[-.7px]">{time}</p><p className="text-[10px] tracking-[.08em] text-muted-foreground">FORTALEZA · UTC−3</p></div>;
}
export function AppShell({ children, dashboard = false, publicRead = false, nav = true }: { children: ReactNode; dashboard?: boolean; publicRead?: boolean; nav?: boolean }) {
  const tvMode = useUiStore(state => state.tvMode);
  const isFullscreen = useUiStore(state => state.isFullscreen);
  const displayScalePercent = useUiStore(state => state.displayScalePercent);
  const status = useAuthStore(state => state.status);
  const presentationActive = dashboard && (tvMode || isFullscreen);
  const scale = presentationActive ? displayScalePercent : 100;
  const normalChrome = !tvMode && !isFullscreen;
  const showLogin = publicRead && status !== "authenticated" && normalChrome;
  async function logout() {
    const auth = getAuthController();
    const result = auth.logout();
    const epoch = auth.generation;
    if (!(await result).revoked && auth.generation === epoch) toast.info("Você saiu deste dispositivo. Não foi possível confirmar o encerramento no serviço de autenticação.");
  }
  const frame = (
    <div className={`min-h-dvh ${dashboard ? "dashboard-shell" : ""} ${dashboard && tvMode ? "tv-mode" : ""}`} data-presentation={presentationActive || undefined} data-display-scale={dashboard ? scale : undefined} style={dashboard ? { "--dashboard-scale": scale / 100 } as CSSProperties : undefined}>
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:z-10 focus:bg-background focus:p-4">Ir para o conteúdo</a>
      <header className="pulse-topbar">
        <Link href={publicRead ? "/monitor" : "/"} aria-label="Ir para a página inicial" className="inline-flex min-w-0 text-inherit no-underline"><Brand className="dashboard-brand" size={presentationActive ? 57 : 37} /></Link>
        <p className="text-xs text-muted-foreground">Central de monitoramento</p>
        <div className="pulse-top-actions">
          <Clock />
          {dashboard && <DisplayControls />}
          {showLogin && <Button asChild><Link href="/login">Login</Link></Button>}
          {publicRead && status === "authenticated" && normalChrome && <Button className="shell-logout" onClick={() => { void logout(); }}><LogOut className="size-4" aria-hidden="true" />Sair</Button>}
          {!publicRead && <Button className="shell-logout" onClick={() => { void logout(); }}><LogOut className="size-4" aria-hidden="true" />Sair</Button>}
        </div>
      </header>
      <main id="main" className={dashboard ? "dashboard-main" : "monitoring-main"}>{!dashboard && nav && <div className="dashboard-nav"><MonitoringNav /></div>}{children}</main>
    </div>
  );
  return publicRead ? frame : <AuthGate>{frame}</AuthGate>;
}
