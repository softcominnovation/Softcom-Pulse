"use client";

import { useCallback } from "react";
import { api } from "@/lib/client/api";
import { configuredResourceSchema, containerSchema, vmWorkloadsSchema } from "@/lib/monitoring/contracts";
import { usePoll } from "@/components/dashboard/use-poll";
import { readSchema } from "@/components/infrastructure/data";

const delay = (result: { refreshAfterMs: number }) => result.refreshAfterMs;
export function useContainers(hostKey?: string) {
  const load = useCallback(async (signal: AbortSignal) => {
    const path = hostKey ? `/monitoring/hosts/${encodeURIComponent(hostKey)}/containers` : "/monitoring/containers";
    const result = readSchema(containerSchema.array()).parse((await api.get(path, { signal })).data);
    if (hostKey && result.data.some(item => item.hostKey !== hostKey)) throw new Error("Unexpected host");
    return result;
  }, [hostKey]);
  return usePoll(`containers:${hostKey ?? "all"}`, load, delay, "Não foi possível atualizar o inventário de containers.", true);
}
export function useServices(id?: string) {
  const load = useCallback(async (signal: AbortSignal) => {
    if (!id) return readSchema(configuredResourceSchema.array()).parse((await api.get("/monitoring/services", { signal })).data);
    const result = readSchema(configuredResourceSchema).parse((await api.get(`/monitoring/services/${encodeURIComponent(id)}`, { signal })).data);
    if (result.data.id !== id || result.data.config.id !== id) throw new Error("Unexpected service");
    return { ...result, data: [result.data] };
  }, [id]);
  return usePoll(`services:${id ?? "all"}`, load, delay, "Não foi possível atualizar os serviços configurados.", true);
}
export function useVmWorkloads(parentHostKey: string, vmKey: string) {
  const load = useCallback(async (signal: AbortSignal) => {
    const path = `/monitoring/hosts/${encodeURIComponent(parentHostKey)}/vms/${encodeURIComponent(vmKey)}/containers`;
    const result = readSchema(vmWorkloadsSchema).parse((await api.get(path, { signal })).data);
    const data = result.data, linked = data.vm.linuxHostKey;
    if (data.vm.vmKey !== vmKey || data.vm.parentHostKey !== parentHostKey || data.containers.some(item => item.hostKey !== linked) || data.configuredServices.some(item => item.config.zabbixHostKey !== linked || item.config.resourceType !== "docker_container" || item.resource && (!("reference" in item.resource) || item.resource.hostKey !== linked))) throw new Error("Unexpected VM workload identity");
    return result;
  }, [parentHostKey, vmKey]);
  return usePoll(JSON.stringify([parentHostKey, vmKey]), load, delay, "Não foi possível atualizar os serviços e containers desta VM.", true);
}
