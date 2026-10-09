"use client";

import type { ReactNode } from "react";

function Bone({ className = "" }: { className?: string }) {
  return <span className={`dashboard-bone ${className}`} aria-hidden="true" />;
}

function PanelSkeleton({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <section className={`dashboard-panel dashboard-skeleton-panel ${className}`} aria-hidden="true">
    <div className="panel-heading"><Bone className="dashboard-bone-icon" /><Bone className="dashboard-bone-title" /></div>
    {children}
  </section>;
}

export function DashboardSkeleton({ label = "Carregando o monitoramento…" }: { label?: string }) {
  return <div className="dashboard-skeleton" role="status" aria-live="polite" aria-busy="true">
    <span className="sr-only">{label}</span>
    <div className="dashboard-skeleton-kpis">
      {Array.from({ length: 4 }, (_, index) => <article className="dashboard-kpi dashboard-skeleton-kpi" key={index} aria-hidden="true">
        <div className="kpi-label"><Bone className="dashboard-bone-label" /><Bone className="dashboard-bone-icon" /></div>
        <Bone className="dashboard-bone-value" />
        <Bone className="dashboard-bone-line" />
      </article>)}
    </div>
    <div className="dashboard-skeleton-grid">
      <PanelSkeleton className="dashboard-skeleton-wide">
        <div className="dashboard-skeleton-cards">
          {Array.from({ length: 4 }, (_, index) => <div className="dashboard-skeleton-card" key={index}>
            <Bone className="dashboard-bone-chip" />
            <Bone className="dashboard-bone-heading" />
            <Bone className="dashboard-bone-line" />
            <Bone className="dashboard-bone-strip" />
          </div>)}
        </div>
      </PanelSkeleton>
      <PanelSkeleton>
        <div className="dashboard-skeleton-list">
          {Array.from({ length: 5 }, (_, index) => <div className="dashboard-skeleton-row" key={index}>
            <Bone className="dashboard-bone-chip" />
            <Bone className="dashboard-bone-heading" />
            <Bone className="dashboard-bone-time" />
          </div>)}
        </div>
      </PanelSkeleton>
      <PanelSkeleton>
        <div className="dashboard-skeleton-asgard">
          <Bone className="dashboard-bone-heading" />
          <Bone className="dashboard-bone-line wide" />
          <Bone className="dashboard-bone-meter" />
          <Bone className="dashboard-bone-meter" />
          <Bone className="dashboard-bone-meter" />
        </div>
      </PanelSkeleton>
    </div>
  </div>;
}
