import type { Page } from "@playwright/test";
import type { Container, History, Host, ReadResult } from "../../lib/monitoring/contracts";
import { overview, presentation } from "./dashboard";

export async function infrastructureFixture(page: Page) {
  const document = presentation(), root = overview(document), hypervisor = root.data.asgardSummary.host!;
  const agent: Host = { ...structuredClone(hypervisor), hostKey: "linux-operacao", name: "Linux operação", role: "linux", vms: [], storages: [], filesystems: [{ ...hypervisor.storages[0], key: "root", name: "/" }], interfaces: [{ key: "eth0", name: "eth0", metrics: { networkReceiveBitsPerSecond: { ...hypervisor.metrics.cpuUsagePercent!, value: 1024, unit: "bits/s" } } }] };
  const state = { hosts: [hypervisor, agent], problems: root.data.problems, containers: [] as Container[], containerCalls: [] as string[], containersFailed: false, containersStale: false, calls: [] as string[], failed: false, hostsFailed: false, empty: false, mismatch: false, delayed: "", release: () => {}, requestStarted: Promise.resolve(), startRequest: () => {} };
  await page.route("**/api/settings/presentation", route => route.fulfill({ json: { data: document, updatedAt: root.lastUpdated } }));
  await page.route("**/api/dashboard/overview?*", route => route.fulfill({ json: root }));
  const envelope = <T>(data: T): ReadResult<T> => ({ data, stale: false, availability: "ready", lastUpdated: root.lastUpdated, refreshAfterMs: 60000 });
  await page.route("**/api/monitoring/hosts", route => route.fulfill(state.hostsFailed ? { status: 503, json: { error: "unavailable" } } : { json: { ...envelope(state.hosts), asgardHostKey: hypervisor.hostKey } }));
  await page.route("**/api/monitoring/hosts/linux-operacao", route => route.fulfill({ json: envelope(agent) }));
  await page.route("**/api/monitoring/problems", route => route.fulfill({ json: envelope(state.problems) }));
  await page.route("**/api/monitoring/hosts/*/containers", route => {
    state.containerCalls.push(new URL(route.request().url()).pathname);
    return route.fulfill(state.containersFailed ? { status: 503, json: { error: "unavailable" } } : { json: { ...envelope(state.containers), stale: state.containersStale } });
  });
  await page.route("**/api/monitoring/hosts/**/history?*", async route => {
    const url = new URL(route.request().url()), parts = url.pathname.split("/");
    state.calls.push(url.pathname + url.search);
    const reference = parts.includes("vms") ? decodeURIComponent(parts[6]) : null;
    if (reference && reference === state.delayed) { state.startRequest(); await new Promise<void>(resolve => { state.release = resolve; }); }
    const range = url.searchParams.get("range") as History["window"];
    const now = Date.now();
    const series = (key: string, values: (number | null)[], unit: "percent" | "bytes" = "percent") => ({ key, unit, points: values.map((value, index) => ({ timestamp: new Date(now - (5 - index) * 3600000).toISOString(), value, ...(range === "7d" && value !== null ? { min: value * .8, max: value * 1.2 } : {}) })) });
    const body = envelope<History>({ resource: { type: reference ? "vm" : "host", hostKey: decodeURIComponent(parts[4]), reference: state.mismatch ? "wrong-vm" : reference }, window: range, source: range === "7d" ? "trends" : "history", coverageLimited: true, series: state.empty ? [] : [series("cpuUsagePercent", [0, 10, null, 30, 15, 20]), series("memoryUsedBytes", [1, 2, null, 3, 2, 4].map(value => value === null ? null : value * 1024 ** 3), "bytes")] });
    await route.fulfill(state.failed ? { status: 503, json: { error: "unavailable" } } : { json: body });
  });
  return state;
}
export async function signIn(page: Page) {
  await page.goto("/login");
  await page.getByLabel("E-mail", { exact: true }).fill("infra@example.test");
  await page.getByLabel("Senha", { exact: true }).fill("test-password");
  await page.getByRole("button", { name: "Entrar", exact: true }).click();
  await page.waitForURL("/");
}
