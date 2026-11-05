"use client";
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import type { PresentationBlock } from "@/lib/config/presentation";
import { storageLayout } from "@/lib/dashboard/layout";
import "./storage-composition.css";

export function StorageComposition({ blocks, split, wall, render, onOverflow, monitor = false }: { blocks: PresentationBlock[]; split: boolean; wall: boolean; render: (block: PresentationBlock) => ReactNode; monitor?: boolean; onOverflow?: (value: boolean) => void }) {
  const plan = storageLayout(blocks, split, wall, monitor), root = useRef<HTMLDivElement>(null);
  const [overflow, setOverflow] = useState(false);
  const signature = JSON.stringify({ summaries: plan.summaries.map(block => block.id), rows: plan.rows.map(row => ({ id: row.blocks[0].block.id, minimum: row.minimum, contentSized: row.contentSized })) });
  useEffect(() => {
    const element = root.current;
    if (!element) return;
    const sizing = JSON.parse(signature) as { rows: { minimum: number; contentSized: boolean }[] };
    const summary = element.querySelector<HTMLElement>(".storage-composition-summaries");
    const rowContainer = element.querySelector<HTMLElement>(".storage-composition-rows");
    const rows = [...element.querySelectorAll<HTMLElement>(".storage-composition-rows > .storage-composition-row")];
    const check = () => {
      const scale = Number(getComputedStyle(element).getPropertyValue("--dashboard-scale")) || 1;
      const rowGap = rowContainer ? parseFloat(getComputedStyle(rowContainer).rowGap) || 0 : 0;
      const summaryHeight = summary ? summary.offsetHeight + (parseFloat(getComputedStyle(element).rowGap) || 0) : 0;
      const needed = sizing.rows.reduce((total, row, index) => {
        const target = rows[index];
        const panels = target ? [...target.querySelectorAll<HTMLElement>('.availability-panel')] : [];
        if (panels.length) {
          const minimum = Math.max(row.contentSized || rows.length > 1 ? 0 : 210 * scale, ...panels.map(panel => {
            const style = getComputedStyle(panel);
            return [...panel.children].reduce((height, child) => {
              const spacing = getComputedStyle(child);
              return height + Math.max((child as HTMLElement).offsetHeight, parseFloat(spacing.height) || 0) + (parseFloat(spacing.marginTop) || 0) + (parseFloat(spacing.marginBottom) || 0);
            }, 0) + (parseFloat(style.borderTopWidth) || 0) + (parseFloat(style.borderBottomWidth) || 0);
          }));
          const value = String(minimum / scale);
          if (target.style.getPropertyValue("--row-minimum") !== value) target.style.setProperty("--row-minimum", value);
          return total + minimum;
        }
        if (target && target.style.getPropertyValue("--row-minimum") !== String(row.minimum)) target.style.setProperty("--row-minimum", String(row.minimum));
        return total + (row.contentSized ? target?.offsetHeight ?? 0 : row.minimum * scale);
      }, 0) + Math.max(0, rows.length - 1) * rowGap + summaryHeight;
      const compact = matchMedia(element.closest(".public-monitor-stage, .root-dashboard-frame.is-zoomed") ? "(min-width:1201px) and (min-height:480px)" : "(min-width:1201px) and (min-height:740px)").matches;
      const next = compact && element.clientHeight > 0 && needed > element.clientHeight + 1;
      setOverflow(next); onOverflow?.(next);
    };
    const observer = new ResizeObserver(check), observed = new Set<Element>();
    const watch = () => {
      const targets = new Set<Element>([element, ...(summary ? [summary] : [])]);
      rows.forEach((row, index) => {
        if (sizing.rows[index]?.contentSized) targets.add(row);
        row.querySelectorAll('.availability-panel > *').forEach(child => targets.add(child));
      });
      observed.forEach(target => { if (!targets.has(target)) { observer.unobserve(target); observed.delete(target); } });
      targets.forEach(target => { if (!observed.has(target)) { observer.observe(target); observed.add(target); } });
      check();
    };
    const changes = new MutationObserver(watch); changes.observe(element, { childList: true, subtree: true });
    watch();
    return () => { observer.disconnect(); changes.disconnect(); };
  }, [signature, onOverflow]);
  return <div ref={root} className={`storage-composition${overflow ? " storage-composition-scroll" : ""}`} data-storage-layout data-overflow={overflow}>
    {!!plan.summaries.length && <div className="storage-composition-summaries">{plan.summaries.map(render)}</div>}
    <div className="storage-composition-rows" style={{ "--composition-rows": plan.rows.length } as CSSProperties}>{plan.rows.map((row, index) => <div key={row.blocks[0].block.id} className={`storage-composition-row${row.paired ? " storage-composition-pair" : ""}${row.contentSized ? " storage-composition-row-content" : ""}${row.blocks.some(({ block }) => block.type === "highlighted_resources") ? " storage-composition-row-measured" : ""}`} style={{ "--row-minimum": row.minimum, "--row-index": index } as CSSProperties}>{row.blocks.map(({ block, span }) => <div className="storage-composition-cell" key={block.id} style={{ "--block-span": span } as CSSProperties}>{render(block)}</div>)}</div>)}</div>
  </div>;
}
