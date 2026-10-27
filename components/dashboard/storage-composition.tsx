"use client";
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import type { PresentationBlock } from "@/lib/config/presentation";
import { storageLayout } from "@/lib/dashboard/layout";
import "./storage-composition.css";

export function StorageComposition({ blocks, split, wall, render, onOverflow }: { blocks: PresentationBlock[]; split: boolean; wall: boolean; render: (block: PresentationBlock) => ReactNode; onOverflow?: (value: boolean) => void }) {
  const plan = storageLayout(blocks, split, wall), root = useRef<HTMLDivElement>(null);
  const [overflow, setOverflow] = useState(false);
  const signature = JSON.stringify(plan.rows.map(row => row.minimum));
  useEffect(() => {
    const element = root.current;
    if (!element) return;
    const check = () => {
      const scale = Number(getComputedStyle(element).getPropertyValue("--dashboard-scale")) || 1;
      const summary = element.querySelector<HTMLElement>(".storage-composition-summaries")?.offsetHeight ?? 0;
      const minima = JSON.parse(signature) as number[];
      const needed = minima.reduce((total, height) => total + height * scale, 0) + minima.length * 12 * scale + summary;
      const compact = matchMedia("(min-width:1201px) and (min-height:740px)").matches;
      const next = compact && element.clientHeight > 0 && needed > element.clientHeight;
      setOverflow(next); onOverflow?.(next);
    };
    const observer = new ResizeObserver(check); observer.observe(element); check();
    return () => observer.disconnect();
  }, [signature, onOverflow]);
  return <div ref={root} className={`storage-composition${overflow ? " storage-composition-scroll" : ""}`} data-storage-layout data-overflow={overflow}>
    {!!plan.summaries.length && <div className="storage-composition-summaries">{plan.summaries.map(render)}</div>}
    <div className="storage-composition-rows" style={{ "--composition-rows": plan.rows.length } as CSSProperties}>{plan.rows.map((row, index) => <div key={row.blocks[0].block.id} className={`storage-composition-row${row.paired ? " storage-composition-pair" : ""}`} style={{ "--row-minimum": row.minimum, "--row-index": index } as CSSProperties}>{row.blocks.map(({ block, span }) => <div className="storage-composition-cell" key={block.id} style={{ "--block-span": span } as CSSProperties}>{render(block)}</div>)}</div>)}</div>
  </div>;
}
