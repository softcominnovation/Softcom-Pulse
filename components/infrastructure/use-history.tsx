"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { api } from "@/lib/client/api";
import { requestCanceled } from "@/lib/client/request-canceled";
import { historySchema, type History, type ReadResult } from "@/lib/monitoring/contracts";
import { readSchema } from "./data";

type Entry = { value: ReadResult<History>; at: number };
const CacheContext = createContext<Map<string, Entry> | null>(null);
export function HistoryCache({ children }: { children: ReactNode }) {
  const [cache] = useState(() => new Map<string, Entry>());
  return <CacheContext value={cache}>{children}</CacheContext>;
}
export function useHistory(resource: History["resource"], range: History["window"]) {
  const cache = useContext(CacheContext);
  const key = JSON.stringify([resource.type, resource.hostKey, resource.reference, range]);
  const [state, setState] = useState<{ key: string; data: ReadResult<History> | null; failed: boolean; loading: boolean }>();
  const [revision, retry] = useState(0);
  const refresh = useCallback(() => retry(value => value + 1), []);
  const latestRetry = useRef(revision);
  const { type, hostKey, reference } = resource;
  useEffect(() => {
    const cached = cache?.get(key);
    const forced = latestRetry.current !== revision;
    latestRetry.current = revision;
    let disposed = false;
    const controller = new AbortController();
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    async function load() {
      if (!forced && cached && Date.now() - cached.at < 60000) { setState({ key, data: cached.value, failed: false, loading: false }); return; }
      setState(previous => ({ key, data: previous?.key === key ? previous.data : null, failed: false, loading: true }));
      try {
        const path = type === "configured_resource" ? `/monitoring/services/${encodeURIComponent(reference!)}/history` : `/monitoring/hosts/${encodeURIComponent(hostKey)}${type === "vm" ? `/vms/${encodeURIComponent(reference!)}` : ""}/history`;
        const result = readSchema(historySchema).parse((await api.get(path, { params: { range }, signal: controller.signal })).data);
        if (result.data.resource.type !== type || result.data.resource.hostKey !== hostKey || result.data.resource.reference !== reference || result.data.window !== range) throw new Error("Unexpected history identity");
        if (disposed) return;
        if (cache) { cache.delete(key); cache.set(key, { value: result, at: Date.now() }); if (cache.size > 24) cache.delete(cache.keys().next().value!); }
        setState({ key, data: result, failed: false, loading: false });
      } catch (error) {
        if (disposed || controller.signal.aborted) return;
        if (requestCanceled(error)) { retryTimer = setTimeout(() => retry(value => value + 1), 100); return; }
        setState(previous => ({ key, data: previous?.key === key ? previous.data : null, failed: true, loading: false }));
      }
    }
    void load();
    return () => { disposed = true; controller.abort(); clearTimeout(retryTimer); };
  }, [cache, key, type, hostKey, reference, range, revision]);
  return { ...(state?.key === key ? state : { data: null, failed: false, loading: true }), refresh };
}
