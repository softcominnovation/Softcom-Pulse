"use client";

import { useEffect, useRef, useState } from "react";
import type { MonitorScrollController } from "@/lib/client/automatic-scroll-events";
import "@/public/monitor-auto-scroll.js";

export function useMonitorAutoScroll(autoStart: boolean) {
  const root = useRef<HTMLDivElement>(null), controller = useRef<MonitorScrollController | null>(null);
  const initialAutoStart = useRef(autoStart);
  const [override, setOverride] = useState<boolean | null>(null);
  const paused = override ?? !autoStart;
  useEffect(() => {
    if (!root.current) return;
    const instance = window.PulseMonitorAutoScroll?.attach(root.current, { paused: !initialAutoStart.current });
    controller.current = instance ?? null;
    return () => { instance?.destroy(); controller.current = null; };
  }, []);
  useEffect(() => controller.current?.setPaused(paused), [paused]);
  return { root, paused, toggle: () => setOverride(!paused) };
}
