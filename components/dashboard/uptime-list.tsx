"use client";

import { Activity } from "lucide-react";
import type { CSSProperties } from "react";
import type { OptionsByType } from "@/lib/config/presentation";
import type { ProbeCard } from "@/lib/monitoring/contracts";
import { formatUptime, probeStatus, sortProbeCards } from "@/lib/probe/status";
import { ProbeDetails } from "./probe-details";
import { ProbeStrip } from "./probe-strip";
export function UptimeList({ items, options }: { items: ProbeCard[]; options: OptionsByType["uptime_list"] }) {
  const sorted = sortProbeCards(items, options.sortBy, options.sortDirection);
  return <section className="dashboard-panel" style={{ "--visible-rows": options.visibleRows } as CSSProperties} aria-label="Uptime das aplicações">
    <div className="panel-heading"><Activity aria-hidden="true" /><h2>Uptime das aplicações</h2></div>
    {sorted.length ? <div className="uptime-scroll" tabIndex={0} role="region" aria-label="Lista de uptime das aplicações"><ul>
      {sorted.map(item => {
        const status = probeStatus(item.reason), uptime = formatUptime(item.uptime24h);
        return <li key={item.id}><ProbeDetails item={item} trigger={<button type="button" className="uptime-row" aria-label={`Detalhes de ${item.displayName}: ${status.label}, disponibilidade ${uptime}`}>
          <strong>{item.displayName}</strong><span className="uptime-percent">{uptime}</span><ProbeStrip reasons={item.paused ? [] : item.strip} />
        </button>} /></li>;
      })}
    </ul></div> : <p className="panel-empty">Nenhuma aplicação habilitada.</p>}
  </section>;
}
