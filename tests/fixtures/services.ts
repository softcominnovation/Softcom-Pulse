import type { Page } from "@playwright/test";
import type { ConfiguredResource, Container, History, Metric, ReadResult, VmWorkloads } from "../../lib/monitoring/contracts";
import { resourceInputSchema } from "../../lib/config/resources";
import { id } from "./dashboard";
import { infrastructureFixture } from "./infrastructure";

export async function servicesFixture(page: Page) {
  const infrastructure = await infrastructureFixture(page), at = new Date().toISOString();
  const evidence = { source: "zabbix" as const, basis: "item" as const, observedAt: at, validUntil: new Date(Date.now() + 3600000).toISOString() };
  const metric = (value: number, unit: Metric["unit"] = "percent"): Metric => ({ value, unit, quality: "fresh", observedAt: at, validUntil: evidence.validUntil });
  const statuses: Container["status"][] = ["running", "stopped", "paused", "restarting", "created", "removing", "dead", "unknown"];
  const containers: Container[] = statuses.map((status, index) => ({ reference: `workload-${index}`, hostKey: "linux-operacao", name: index === 0 ? "same-service" : `container-${status}`, image: "registry.example.test/operacao/imagem-com-nome-extenso:2026.10", status, health: index === 0 ? "not_configured" : index === 1 ? "healthy" : index === 2 ? "starting" : index === 3 ? "unhealthy" : "unknown", healthReason: index === 5 ? "unsupported" : "observed", healthObservedAt: at, healthValidUntil: evidence.validUntil, evidence, metrics: { cpuUsagePercent: metric(12), memoryUsagePercent: metric(30), memoryUsedBytes: metric(1024 ** 3, "bytes"), memoryTotalBytes: metric(4 * 1024 ** 3, "bytes"), networkReceiveBitsPerSecond: metric(1000000, "bits/s"), networkTransmitBitsPerSecond: metric(2000000, "bits/s"), uptimeSeconds: metric(300, "seconds"), restartCount: metric(index, "count") } }));
  const config = (index: number, target: Container | null, resolution: ConfiguredResource["resolution"] = "resolved"): ConfiguredResource => {
    const config = { ...resourceInputSchema.parse({ resourceType: "docker_container", zabbixHostKey: "linux-operacao", selectorType: "exact_name", selectorValue: target?.name ?? "missing", displayName: `Serviço ${index}`, enabled: index !== 2, critical: true, dashboardEnabled: true, presentation: { showHealth: true, showHealthTimeline: true, showNetwork: true, showUptime: true } }), id: id(700 + index), createdAt: at, updatedAt: at };
    return { id: config.id, config, resolved: resolution === "resolved", resolution, resource: target, metrics: target?.metrics ?? {} };
  };
  const services = [config(0, containers[1]), config(1, null, "ambiguous"), config(2, containers[0]), config(3, null, "missing")];
  infrastructure.containers = containers;
  const secondHost = { ...structuredClone(infrastructure.hosts[1]), hostKey: "another-agent", name: "Outro Agent" };
  infrastructure.hosts.push(secondHost);
  infrastructure.hosts[0].vms[1].linuxHostKey = secondHost.hostKey;
  const other = { ...structuredClone(containers[0]), reference: "other-container", hostKey: secondHost.hostKey, image: "only-other-host:1" };
  const state = { infrastructure, containers, other, services, requests: [] as string[], historyCalls: [] as string[], workloadCalls: [] as string[], fail: false, stale: false, mode: "auto", mismatch: false, wait: null as Promise<void> | null, pollMs: 60000 };
  const envelope = <T>(data: T, availability: ReadResult<T>["availability"] = "ready"): ReadResult<T> => ({ data, availability, stale: state.stale, lastUpdated: at, refreshAfterMs: state.pollMs });
  page.on("request", request => { if (request.url().includes("/api/monitoring")) state.requests.push(new URL(request.url()).pathname); });
  await page.route("**/api/monitoring/containers", route => route.fulfill(state.fail ? { status: 503, json: { error: { code: "cache_unavailable" } } } : { json: envelope([...state.containers, state.other]) }));
  await page.route("**/api/monitoring/signal-targets", route => route.fulfill({ json: { data: [] } }));
  await page.route("**/api/monitoring/services", route => route.fulfill({ json: envelope(state.services) }));
  await page.route("**/api/monitoring/services/*", route => {
    const item = state.services.find(item => item.id === new URL(route.request().url()).pathname.split("/").at(-1));
    return route.fulfill(item ? { json: envelope(item) } : { status: 404, json: { error: { code: "resource_not_found" } } });
  });
  await page.route("**/api/monitoring/services/*/history?*", route => {
    const url = new URL(route.request().url()), item = state.services.find(item => item.id === url.pathname.split("/")[4])!;
    state.historyCalls.push(url.pathname + url.search);
    const times = [3, 2, 1, 0].map(hours => new Date(Date.now() - hours * 3600000).toISOString());
    const data: History = { resource: { type: "configured_resource", hostKey: item.config.zabbixHostKey, reference: item.id }, window: url.searchParams.get("range") as History["window"], source: "history", coverageLimited: true, series: [{ key: "cpuUsagePercent", unit: "percent", points: times.map((timestamp, index) => ({ timestamp, value: index === 2 ? null : index * 10 })) }, { key: "memoryUsedBytes", unit: "bytes", points: times.map(timestamp => ({ timestamp, value: 1024 ** 3 })) }], states: [
      { key: "health", aggregation: "worst_state", coverageLimited: true, segments: [{ from: times[0], to: times[1], state: "healthy", observedAt: times[0] }, { from: times[1], to: times[2], state: "unknown", observedAt: null }, { from: times[2], to: times[3], state: "not_configured", observedAt: times[2] }] },
      { key: "status", aggregation: "worst_state", coverageLimited: false, segments: [{ from: times[0], to: times[3], state: "stopped", observedAt: times[0] }] },
    ] };
    return route.fulfill({ json: envelope(data) });
  });
  await page.route("**/api/monitoring/hosts/*/vms/*/containers", async route => {
    const path = new URL(route.request().url()).pathname, vmKey = decodeURIComponent(path.split("/")[6]);
    state.workloadCalls.push(path);
    if (state.wait) await state.wait;
    if (state.fail) return route.fulfill({ status: 503, json: { error: { code: "cache_unavailable" } } });
    const found = infrastructure.hosts[0].vms.find(vm => vm.vmKey === vmKey);
    if (!found) return route.fulfill({ status: 404, json: { error: { code: "vm_not_found" } } });
    const vm = structuredClone(found);
    const association = state.mode === "unlinked" || !vm.linuxHostKey ? "unlinked" : state.mode === "host_unavailable" ? "host_unavailable" : "linked";
    const data: VmWorkloads = { vm, association, containers: association !== "linked" || ["no_data", "empty"].includes(state.mode) ? [] : vm.linuxHostKey === secondHost.hostKey ? [other] : state.containers, configuredServices: association === "linked" && vm.linuxHostKey !== secondHost.hostKey ? state.services : [] };
    if (state.mismatch) data.vm.vmKey = "wrong";
    await route.fulfill({ json: envelope(data, association !== "linked" ? "unavailable" : state.mode === "no_data" ? "no_data" : "ready") }).catch(() => {});
  });
  return state;
}
