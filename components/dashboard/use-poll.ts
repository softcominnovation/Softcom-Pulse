"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

export function usePoll<T>(key: string | null, load: (signal: AbortSignal) => Promise<T>, delay: (value: T) => number, message: string) {
  const [result, setResult] = useState<{ key: string | null; data: T | null; failed: boolean; loading: boolean }>({ key: null, data: null, failed: false, loading: true });
  const refreshRef = useRef<() => void>(() => {});
  const notified = useRef(false);
  const refresh = useCallback(() => refreshRef.current(), []);
  useEffect(() => {
    if (!key) return;
    let disposed = false, running = false, timer: ReturnType<typeof setTimeout> | undefined, interval = 20000;
    const controller = new AbortController();
    async function run() {
      if (running || disposed) return;
      clearTimeout(timer); running = true;
      try {
        const data = await load(controller.signal);
        if (disposed) return;
        interval = Math.max(1000, delay(data));
        setResult({ key, data, failed: false, loading: false });
        notified.current = false;
      } catch {
        if (disposed || controller.signal.aborted) return;
        setResult(previous => ({ key, data: previous.key === key ? previous.data : null, failed: true, loading: false }));
        if (!notified.current) { toast.error(message); notified.current = true; }
      } finally {
        running = false;
        if (!disposed) timer = setTimeout(() => { void run(); }, interval);
      }
    }
    const visible = () => { if (!document.hidden) void run(); };
    refreshRef.current = () => { void run(); };
    document.addEventListener("visibilitychange", visible);
    void run();
    return () => { disposed = true; controller.abort(); clearTimeout(timer); refreshRef.current = () => {}; document.removeEventListener("visibilitychange", visible); };
  }, [key, load, delay, message]);
  return { ...(result.key === key ? result : { key, data: null, failed: false, loading: true }), refresh };
}
