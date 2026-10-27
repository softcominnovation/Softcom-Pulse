"use client";
import { useCallback } from "react";
import { api } from "@/lib/client/api";
import { storageInventorySchema, storageViewSchema } from "@/lib/storage/contracts";
import { readSchema } from "@/components/infrastructure/data";
import { usePoll } from "@/components/dashboard/use-poll";
const delay = (result: { refreshAfterMs: number }) => result.refreshAfterMs;
export function useStorages() {
  const load = useCallback(async (signal: AbortSignal) => readSchema(storageInventorySchema).parse((await api.get("/monitoring/storages", { signal })).data), []);
  return usePoll("storages", load, delay, "Não foi possível atualizar os Storages. A última leitura foi preservada.", true);
}
export function useStorage(key: string, open: boolean) {
  const load = useCallback(async (signal: AbortSignal) => {
    const result = readSchema(storageViewSchema).parse((await api.get(`/monitoring/storages/${encodeURIComponent(key)}`, { signal })).data);
    if (result.data.storageKey !== key) throw new Error("Unexpected storage identity");
    return result;
  }, [key]);
  return usePoll(open ? `storage:${key}` : null, load, delay, "Não foi possível atualizar este Storage.", true);
}
