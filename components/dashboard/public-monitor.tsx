"use client";

import { useCallback, useState, type CSSProperties } from "react";
import type { PresentationDocument } from "@/lib/config/presentation";
import { AppShell } from "@/components/layout/app-shell";
import { Dashboard } from "./dashboard";
import "./public-monitor.css";

export function PublicMonitor({ initialZoomPercent }: { initialZoomPercent: number }) {
  const [zoom, setZoom] = useState(initialZoomPercent);
  const update = useCallback((document: PresentationDocument) => setZoom(document.publicMonitorZoomPercent), []);
  return <div className="public-monitor-frame" data-public-monitor-zoom={zoom}>
    <div className="public-monitor-stage" style={{ "--public-monitor-zoom": zoom / 100 } as CSSProperties}>
      <AppShell dashboard publicRead publicMonitor><Dashboard initialTvMode onPresentation={update} /></AppShell>
    </div>
  </div>;
}
