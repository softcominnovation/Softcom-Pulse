import type { Page } from "@playwright/test";
import { servicesFixture } from "./services";
import { overview, id } from "./dashboard";
import { initialPresentation, presentationSettingsSchema, type PresentationDocument } from "../../lib/config/presentation";
import { resourceInputSchema, type ResourceConfig } from "../../lib/config/resources";
import type { Template } from "../../lib/monitoring/templates";
import type { TemplateConfig } from "../../lib/config/templates";

export async function adminFixture(page: Page) {
  const service = await servicesFixture(page), at = new Date().toISOString(); let sequence = 4000;
  const evidence = service.infrastructure.hosts[0].evidence;
  const templates: Template[] = ["worker", "manager"].map((role, index) => ({ templateKey: `vm-${String(index + 1).padStart(32, "0")}`, hostKey: "ASGARD", templateId: String(7000 + index), technicalName: `tpl-${role}-ubuntu-24`, displayName: `tpl-${role}-ubuntu-24`, virtualizationType: "qemu", role: role as "worker" | "manager", roleSource: "name_convention", memoryBytes: { value: 8 * 1024 ** 3, unit: "bytes", quality: "fresh", observedAt: at }, virtualCpuCount: { value: 4, unit: "count", quality: "fresh", observedAt: at }, diskBytes: null, operatingSystem: null, state: "stopped", evidence, configuration: null }));
  const state = { service, document: initialPresentation(() => id(sequence++)) as PresentationDocument, resources: service.services.map(item => item.config) as ResourceConfig[], templates, preferences: [] as TemplateConfig[], writes: [] as { method: string; path: string; body: Record<string, unknown> }[], presentationConflict: false, templateConflict: false, resourceConflict: false, settingsFail: false, templatesFail: false, wait: null as Promise<void> | null };
  const envelope = <T>(data: T) => ({ data, availability: "ready", stale: false, lastUpdated: at, refreshAfterMs: 60000 });
  const record = (request: { method: () => string; url: () => string; postDataJSON: () => unknown }) => state.writes.push({ method: request.method(), path: new URL(request.url()).pathname, body: request.postDataJSON() as Record<string, unknown> });
  await page.route("**/api/settings/resources", route => route.fulfill(state.settingsFail ? { status: 503, json: { error: { code: "database_unavailable" } } } : { json: { data: state.resources } }));
  await page.route("**/api/settings/presentation", async route => {
    if (route.request().method() === "PUT") {
      record(route.request()); if (state.wait) await state.wait;
      if (state.presentationConflict) return route.fulfill({ status: 409, json: { error: { code: "revision_conflict" } } });
      const body = route.request().postDataJSON(), result = presentationSettingsSchema.safeParse(body.settings);
      if (!result.success) return route.fulfill({ status: 400, json: { error: { code: "invalid_request" } } });
      state.document = { ...result.data, revision: state.document.revision + 1 };
    }
    return route.fulfill({ json: { data: state.document, updatedAt: at } });
  });
  await page.route("**/api/dashboard/overview*", route => route.fulfill({ json: overview(state.document, new URL(route.request().url()).searchParams.get("screenId") ?? undefined) }));
  await page.route("**/api/monitoring/services", async route => {
    if (route.request().method() !== "POST") return route.fulfill({ json: envelope(service.services) });
    record(route.request()); if (state.wait) await state.wait;
    if (state.resourceConflict) return route.fulfill({ status: 409, json: { error: { code: "resource_conflict" } } });
    const body = { ...route.request().postDataJSON() }; delete body.context;
    const input = resourceInputSchema.parse(body), config = { ...input, id: id(sequence++), createdAt: at, updatedAt: at }; state.resources.push(config);
    return route.fulfill({ status: 201, json: { data: config } });
  });
  await page.route("**/api/monitoring/services/*", async route => {
    const request = route.request(), key = new URL(request.url()).pathname.split("/").at(-1), config = state.resources.find(item => item.id === key)!;
    if (!["DELETE", "PATCH"].includes(request.method())) return route.fallback();
    record(request); if (state.wait) await state.wait;
    if (request.method() === "DELETE") { state.resources = state.resources.filter(item => item.id !== key); return route.fulfill({ status: 204 }); }
    const body = { ...request.postDataJSON() }; delete body.context;
    const saved = { ...config, ...resourceInputSchema.parse(body) };
    state.resources = state.resources.map(item => item.id === key ? saved : item); return route.fulfill({ json: { data: saved } });
  });
  await page.route("**/api/monitoring/templates*", route => route.fulfill(state.templatesFail ? { status: 503, json: { error: { code: "cache_unavailable" } } } : { json: envelope(state.templates) }));
  await page.route("**/api/settings/templates", route => route.fulfill(state.settingsFail ? { status: 503, json: { error: { code: "database_unavailable" } } } : { json: { data: state.preferences } }));
  await page.route("**/api/settings/templates/*", async route => {
    const request = route.request(); record(request); if (state.wait) await state.wait;
    if (state.templateConflict) return route.fulfill({ status: 409, json: { error: { code: "revision_conflict" } } });
    const key = new URL(request.url()).pathname.split("/").at(-1)!, target = state.templates.find(item => item.templateKey === key), current = state.preferences.find(item => item.templateKey === key), input = request.postDataJSON();
    const value: TemplateConfig = { templateKey: key, hostKey: target?.hostKey ?? current!.hostKey, templateId: target?.templateId ?? current!.templateId, virtualizationType: target?.virtualizationType ?? current!.virtualizationType, originalName: target?.technicalName ?? current!.originalName, displayName: input.displayName, roleOverride: input.roleOverride, revision: (current?.revision ?? 0) + 1, createdAt: current?.createdAt ?? at, updatedAt: at };
    state.preferences = [...state.preferences.filter(item => item.templateKey !== key), value]; return route.fulfill({ json: { data: value } });
  });
  await page.route("**/api/settings/vms", route => route.fulfill({ json: { data: [] } }));
  return state;
}
