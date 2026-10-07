import type { Page } from "@playwright/test";
import { adminFixture } from "./admin";
import { namesForInventory } from "../../lib/monitoring/display-names";
import { vmWriteSchema, type VmDisplayConfig } from "../../lib/config/vms";
import { resolveResource } from "../../lib/monitoring/selectors";

export async function displayNamesFixture(page: Page) {
  const admin = await adminFixture(page), hosts = admin.service.infrastructure.hosts;
  hosts[0].vms[0].vmKey = "vm-" + "3".repeat(32);
  hosts[0].vms[1].vmKey = "vm-" + "4".repeat(32);
  const state = { admin, hosts, preferences: [] as VmDisplayConfig[], conflict: false };
  const names = () => namesForInventory(hosts, [...admin.service.containers, admin.service.other], admin.resources, state.preferences);
  const envelope = <T>(data: T) => ({ data, availability: "ready", stale: false, lastUpdated: new Date().toISOString(), refreshAfterMs: 1000 });
  await page.route("**/api/settings/vms", route => route.fulfill({ json: { data: state.preferences } }));
  await page.route("**/api/settings/vms/*", async route => {
    const request = route.request(), key = new URL(request.url()).pathname.split("/").at(-1)!;
    admin.writes.push({ method: request.method(), path: new URL(request.url()).pathname, body: request.postDataJSON() });
    const input = vmWriteSchema.parse(request.postDataJSON()), current = state.preferences.find(item => item.vmKey === key);
    if (state.conflict || (current?.revision ?? 0) !== input.expectedRevision) return route.fulfill({ status: 409, json: { error: { code: "revision_conflict" } } });
    const vm = hosts.flatMap(host => host.vms).find(vm => vm.vmKey === key), at = new Date().toISOString();
    const saved: VmDisplayConfig = { vmKey: key, hostKey: vm?.parentHostKey ?? current!.hostKey, vmId: vm?.vmId ?? current!.vmId, originalName: vm?.name ?? current!.originalName, virtualizationType: "qemu", displayName: input.displayName, revision: input.expectedRevision + 1, createdAt: current?.createdAt ?? at, updatedAt: at };
    state.preferences = [...state.preferences.filter(item => item.vmKey !== key), saved];
    return route.fulfill({ json: { data: saved } });
  });
  await page.route("**/api/monitoring/hosts", route => route.fulfill({ json: { ...envelope(hosts.map(names().host)), asgardHostKey: hosts[0].hostKey } }));
  await page.route("**/api/monitoring/containers", route => route.fulfill({ json: envelope([...admin.service.containers, admin.service.other].map(names().container)) }));
  await page.route("**/api/monitoring/hosts/*/vms/*/containers", route => {
    const key = decodeURIComponent(new URL(route.request().url()).pathname.split("/")[6]), vm = hosts[0].vms.find(vm => vm.vmKey === key)!;
    const linked = !!vm.linuxHostKey, containers = linked ? [...admin.service.containers, admin.service.other].filter(item => item.hostKey === vm.linuxHostKey) : [];
    const mapping = names();
    return route.fulfill({ json: envelope({ vm: mapping.vm(vm), association: linked ? "linked" : "unlinked", containers: containers.map(mapping.container), configuredServices: [] }) });
  });
  await page.route("**/api/monitoring/services", route => {
    if (route.request().method() === "POST") return route.fallback();
    const mapping = names(), inventory = { hosts: hosts.map(mapping.host), containers: [...admin.service.containers, admin.service.other].map(mapping.container) };
    const resources = admin.resources.map(config => { const resolved = resolveResource(config, inventory); return { id: config.id, config, resolved: resolved.resolved, resolution: resolved.resolution, resource: resolved.target, metrics: resolved.target?.metrics ?? {} }; });
    return route.fulfill({ json: envelope(resources) });
  });
  return state;
}
