"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { createPollCache, resolvePollView, type PollCache, type PollResult } from "@/lib/dashboard/poll-view";

export { createPollCache, resolvePollView, type PollCache, type PollResult };

export function usePoll<T>(
  key: string | null,
  load: (signal: AbortSignal) => Promise<T>,
  delay: (value: T) => number,
  message: string,
  visibleOnly = false,
  cache?: PollCache<T>,
) {
  const [result, setResult] = useState<PollResult<T>>({ key: null, data: null, failed: false, loading: true });
  const [ownedCache] = useState(() => createPollCache<T>());
  const store = cache ?? ownedCache;
  const refreshRef = useRef<() => void>(() => {});
  const notified = useRef(false);
  const refresh = useCallback(() => refreshRef.current(), []);

  useEffect(() => {
    if (!key) return;
    const pollKey = key;
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
        store.set(pollKey, data);
        setResult({ key: pollKey, data, failed: false, loading: false });
        notified.current = false;
      } catch {
        if (disposed || controller.signal.aborted) return;
        setResult(previous => ({
          key: pollKey,
          data: previous.key === pollKey ? previous.data : (store.get(pollKey) ?? null),
          failed: true,
          loading: false,
        }));
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
  }, [key, load, delay, message, visibleOnly, store]);

  const cached = key ? store.get(key) : undefined;
  return { ...resolvePollView(result, key, cached), refresh };
}
