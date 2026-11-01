"use client";

import { useCallback, useState, type CSSProperties } from "react";
import { IconPlayerPause, IconPlayerPlay } from "@tabler/icons-react";
import type { PresentationDocument } from "@/lib/config/presentation";
import { AppShell } from "@/components/layout/app-shell";
import { Dashboard } from "./dashboard";
import { Button } from "@/components/ui/button";
import { useMonitorAutoScroll } from "./use-monitor-auto-scroll";
import "./public-monitor.css";

export function PublicMonitor({ initialZoomPercent }: { initialZoomPercent: number }) {
  const [zoom, setZoom] = useState(initialZoomPercent);
  const { root, paused, toggle } = useMonitorAutoScroll();
  const update = useCallback((document: PresentationDocument) => setZoom(document.publicMonitorZoomPercent), []);
  return <div ref={root} className="public-monitor-frame" data-public-monitor-zoom={zoom}>
    <div className="public-monitor-stage" style={{ "--public-monitor-zoom": zoom / 100 } as CSSProperties}>
      <AppShell dashboard publicRead publicMonitor><Dashboard initialTvMode onPresentation={update} extraControls={<Button variant="ghost" aria-label={paused ? "Retomar rolagem automática" : "Pausar rolagem automática"} aria-pressed={paused} onClick={toggle}>{paused ? <IconPlayerPlay aria-hidden="true" /> : <IconPlayerPause aria-hidden="true" />}Rolagem</Button>} /></AppShell>
    </div>
  </div>;
}
