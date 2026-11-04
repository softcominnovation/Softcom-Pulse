"use client";

import { useCallback, useState, type CSSProperties } from "react";
import type { PresentationDocument } from "@/lib/config/presentation";
import { AppShell } from "@/components/layout/app-shell";
import { Dashboard } from "./dashboard";
import "./root-dashboard.css";

export function RootDashboard() {
  const [zoom, setZoom] = useState(100);
  const update = useCallback((document: PresentationDocument) => setZoom(document.dashboardZoomPercent), []);
  return <div className="root-dashboard-frame is-zoomed" data-dashboard-zoom={zoom}>
    <div className="root-dashboard-stage" style={{ "--root-dashboard-zoom": zoom / 100 } as CSSProperties}>
      <AppShell dashboard><Dashboard onPresentation={update} /></AppShell>
    </div>
  </div>;
}
