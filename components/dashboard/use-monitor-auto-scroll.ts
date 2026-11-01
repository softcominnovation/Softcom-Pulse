"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { MonitorScrollController } from "@/lib/client/automatic-scroll-events";
import "@/public/monitor-auto-scroll.js";

const media = "(prefers-reduced-motion: reduce)";
function subscribeMotion(change: () => void) {
  const preference = window.matchMedia(media);
  preference.addEventListener("change", change);
  return () => preference.removeEventListener("change", change);
}
const reducedMotion = () => window.matchMedia(media).matches;
const serverMotion = () => false;

export function useMonitorAutoScroll() {
  const root = useRef<HTMLDivElement>(null), controller = useRef<MonitorScrollController | null>(null);
  const reduced = useSyncExternalStore(subscribeMotion, reducedMotion, serverMotion);
  const [override, setOverride] = useState<boolean | null>(null);
  const paused = override ?? reduced;
  useEffect(() => {
    if (!root.current) return;
    const instance = window.PulseMonitorAutoScroll?.attach(root.current, { paused: reducedMotion() });
    controller.current = instance ?? null;
    return () => { instance?.destroy(); controller.current = null; };
  }, []);
  useEffect(() => controller.current?.setPaused(paused), [paused]);
  return { root, paused, toggle: () => setOverride(!paused) };
}
