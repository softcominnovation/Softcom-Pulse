"use client";
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import type { PresentationBlock } from "@/lib/config/presentation";
import { storageLayout } from "@/lib/dashboard/layout";
import "./storage-composition.css";

export function StorageComposition({ blocks, split, wall, render, onOverflow }: { blocks: PresentationBlock[]; split: boolean; wall: boolean; render: (block: PresentationBlock) => ReactNode; onOverflow?: (value: boolean) => void }) {
  const plan = storageLayout(blocks, split, wall), root = useRef<HTMLDivElement>(null);
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
      const summaryHeight = summary ? summary.getBoundingClientRect().height + (parseFloat(getComputedStyle(element).rowGap) || 0) : 0;
      const needed = sizing.rows.reduce((total, row, index) => total + (row.contentSized ? rows[index]?.getBoundingClientRect().height ?? 0 : row.minimum * scale), 0) + Math.max(0, rows.length - 1) * rowGap + summaryHeight;
      const compact = matchMedia("(min-width:1201px) and (min-height:740px)").matches;
      const next = compact && element.clientHeight > 0 && needed > element.clientHeight + 1;
      setOverflow(next); onOverflow?.(next);
    };
    const observer = new ResizeObserver(check); observer.observe(element);
    if (summary) observer.observe(summary);
    rows.forEach((row, index) => { if (sizing.rows[index]?.contentSized) observer.observe(row); });
    check();
    return () => observer.disconnect();
  }, [signature, onOverflow]);
  return <div ref={root} className={`storage-composition${overflow ? " storage-composition-scroll" : ""}`} data-storage-layout data-overflow={overflow}>
    {!!plan.summaries.length && <div className="storage-composition-summaries">{plan.summaries.map(render)}</div>}
    <div className="storage-composition-rows" style={{ "--composition-rows": plan.rows.length } as CSSProperties}>{plan.rows.map((row, index) => <div key={row.blocks[0].block.id} className={`storage-composition-row${row.paired ? " storage-composition-pair" : ""}${row.contentSized ? " storage-composition-row-content" : ""}`} style={{ "--row-minimum": row.minimum, "--row-index": index } as CSSProperties}>{row.blocks.map(({ block, span }) => <div className="storage-composition-cell" key={block.id} style={{ "--block-span": span } as CSSProperties}>{render(block)}</div>)}</div>)}</div>
  </div>;
}
