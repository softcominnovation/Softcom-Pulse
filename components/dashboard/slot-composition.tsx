"use client";
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import type { PresentationBlock } from "@/lib/config/presentation";
import type { OverviewSlots } from "@/lib/config/overview-slots";
import { overviewSlotLayout, overviewPanelMinimum } from "@/lib/dashboard/overview-slot-layout";
import "./slot-composition.css";

export function SlotComposition({ blocks, slots, render, onOverflow }: { blocks: PresentationBlock[]; slots: OverviewSlots; render: (block: PresentationBlock) => ReactNode; onOverflow?: (value: boolean) => void }) {
  const plan = overviewSlotLayout(blocks, slots), root = useRef<HTMLDivElement>(null), [overflow, setOverflow] = useState(false);
  const signature = JSON.stringify({ summaries: plan.summaries.map(block => block.id), rows: plan.rows.map(row => ({ key: row.key, groups: row.groups.map(group => ({ key: group.key, ids: group.blocks.map(block => block.id) })), minimum: row.minimum })) });
  useEffect(() => {
    const element = root.current;
    if (!element) return;
    const check = () => {
      const scale = Number(getComputedStyle(element).getPropertyValue("--dashboard-scale")) || 1;
      const rowContainer = element.querySelector<HTMLElement>(".slot-composition-rows")!;
      const rows = [...rowContainer.children] as HTMLElement[];
      const gap = parseFloat(getComputedStyle(rowContainer).rowGap) || 0;
      let limited = false;
      const needed = rows.reduce((sum, row) => {
        let availability = 0;
        const minimum = Math.max(...[...row.children].map(group => {
          const children = [...group.children] as HTMLElement[];
          return children.reduce((total, child) => {
            const panel = child.querySelector<HTMLElement>(".availability-panel");
            if (!panel) return total + overviewPanelMinimum * scale;
            const style = getComputedStyle(panel);
            const height = [...panel.children].reduce((sum, item) => {
              const spacing = getComputedStyle(item);
              return sum + Math.max((item as HTMLElement).offsetHeight, parseFloat(spacing.height) || 0) + (parseFloat(spacing.marginTop) || 0) + (parseFloat(spacing.marginBottom) || 0);
            }, 0) + (parseFloat(style.borderTopWidth) || 0) + (parseFloat(style.borderBottomWidth) || 0);
            availability = Math.max(availability, height);
            return total + height;
          }, 0) + Math.max(0, children.length - 1) * (parseFloat(getComputedStyle(group).rowGap) || 0);
        }));
        if (availability && minimum > availability + 1) limited = true;
        const value = String(minimum / scale);
        if (row.style.getPropertyValue("--slot-row-minimum") !== value) row.style.setProperty("--slot-row-minimum", value);
        return sum + minimum;
      }, 0) + Math.max(0, rows.length - 1) * gap;
      const summary = element.querySelector<HTMLElement>(".slot-composition-summaries");
      const summaryHeight = summary ? summary.offsetHeight + (parseFloat(getComputedStyle(element).rowGap) || 0) : 0;
      const desktop = matchMedia("(min-width:1201px) and (min-height:480px)").matches;
      const next = desktop && needed + summaryHeight > element.clientHeight + 1;
      setOverflow(next); onOverflow?.(next || desktop && limited);
    };
    const observer = new ResizeObserver(check), observed = new Set<Element>();
    const watch = () => {
      const targets = new Set<Element>([element, ...element.querySelectorAll(".slot-composition-summaries, .availability-panel > *")]);
      observed.forEach(node => { if (!targets.has(node)) { observer.unobserve(node); observed.delete(node); } });
      targets.forEach(node => { if (!observed.has(node)) { observer.observe(node); observed.add(node); } });
      check();
    };
    const changes = new MutationObserver(watch);
    changes.observe(element, { childList: true, subtree: true }); watch();
    return () => { observer.disconnect(); changes.disconnect(); };
  }, [signature, onOverflow]);
  return <div ref={root} className={`slot-composition${overflow ? " slot-composition-scroll" : ""}`} data-slot-layout data-overflow={overflow}>
    {!!plan.summaries.length && <div className="slot-composition-summaries">{plan.summaries.map(render)}</div>}
    <div className="slot-composition-rows">{plan.rows.map(row => <div key={row.key} className={`slot-composition-row${row.hasAvailability ? " slot-composition-row-measured" : ""}`} style={{ "--slot-row-minimum": row.minimum } as CSSProperties}>
      {row.groups.map(group => <div key={group.key} className="slot-composition-group" data-overview-slot={group.key} data-panel-count={group.blocks.length}>{group.blocks.map(block => <div className="slot-panel" data-slot-panel={block.id} key={block.id}>{render(block)}</div>)}</div>)}
    </div>)}</div>
  </div>;
}
