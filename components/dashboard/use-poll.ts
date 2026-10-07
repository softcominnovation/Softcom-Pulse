"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

export function usePoll<T>(key: string | null, load: (signal: AbortSignal) => Promise<T>, delay: (value: T) => number, message: string, visibleOnly = false) {
  const [result, setResult] = useState<{ key: string | null; data: T | null; failed: boolean; loading: boolean }>({ key: null, data: null, failed: false, loading: true });
  const refreshRef = useRef<() => void>(() => {});
  const notified = useRef(false);
  const refresh = useCallback(() => refreshRef.current(), []);
  useEffect(() => {
    if (!key) return;
    let disposed = false, running = false, pendingRefresh = false, timer: ReturnType<typeof setTimeout> | undefined, interval = 20000;
    let controller = new AbortController();
    async function run() {
      if (running || disposed || (visibleOnly && document.hidden)) return;
      clearTimeout(timer); running = true;
      controller = new AbortController();
      try {
        const data = await load(controller.signal);
        if (disposed || controller.signal.aborted) return;
        interval = Math.max(1000, delay(data));
        setResult({ key, data, failed: false, loading: false });
        notified.current = false;
      } catch {
        if (disposed || controller.signal.aborted) return;
        setResult(previous => ({ key, data: previous.key === key ? previous.data : null, failed: true, loading: false }));
        if (!notified.current) { toast.error(message); notified.current = true; }
      } finally {
        running = false;
        if (!disposed && (!visibleOnly || !document.hidden)) timer = setTimeout(() => { void run(); }, pendingRefresh ? 0 : interval);
        pendingRefresh = false;
      }
    }
    const visible = () => { if (!document.hidden) void run(); else if (visibleOnly) { clearTimeout(timer); controller.abort(); } };
    const preferencesChanged = () => { if (running) pendingRefresh = true; else visible(); };
    refreshRef.current = () => { void run(); };
    document.addEventListener("visibilitychange", visible);
    window.addEventListener("pulse:preferences-changed", preferencesChanged);
    void run();
    return () => { disposed = true; controller.abort(); clearTimeout(timer); refreshRef.current = () => {}; document.removeEventListener("visibilitychange", visible); window.removeEventListener("pulse:preferences-changed", preferencesChanged); };
  }, [key, load, delay, message, visibleOnly]);
  return { ...(result.key === key ? result : { key, data: null, failed: false, loading: true }), refresh };
}
