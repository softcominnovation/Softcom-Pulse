import "server-only";
import { z } from "zod";
import { hostKeySchema, uuidSchema, historyRangeSchema } from "../../config/resources.ts";
import { createResource, updateResource, deleteResource, getPresentation, savePresentation, getResource, listResources } from "../config/repository.ts";
import { BffError, jsonBody, protectedResponse, queryParams } from "../bff.ts";
import { storageKeySchema } from "../../config/storages.ts";
import { listStorageConfigs, saveStorageConfig } from "../config/storages.ts";
import { readStorage, readStorages } from "./storages.ts";
import { readHosts, readHost, readContainers, readProblems, readServices, readOverview, readHistory } from "./read.ts";
import { templateKeySchema } from "../../config/templates.ts";
import { listTemplateConfigs, saveTemplateConfig } from "../config/templates.ts";
import { readTemplates } from "./templates.ts";
import { readVmWorkloads } from "./vm-workloads.ts";
import { vmKeySchema } from "../../config/vms.ts";
import { resourceContextSchema } from "../../config/resource-context.ts";
import { listVmConfigs, saveVmConfig } from "../config/vms.ts";
import { externalServiceHistoryRangeSchema } from "../../config/external-services.ts";
import { listExternalServicesWithUptime } from "../probe/overview.ts";
import { createExternalService, deleteExternalService, externalServiceHistory, updateExternalService } from "../probe/repository.ts";
import { vpsDetailQuerySchema } from "../../config/standalone-vps.ts";
import { createStandaloneVps, createVpsStack, deleteStandaloneVps, deleteVpsStack, listStandaloneVps, readStandaloneVps, updateStandaloneVps, updateVpsStack } from "../vps/repository.ts";
import { deleteMonitoringScopeLink, postMonitoringScopeLink, readMonitoringScopeDocument } from "../config/monitoring-scope.ts";
import { signalHistoryRangeSchema } from "../../config/signal-targets.ts";
import {
  addSignalInfraLink, createSignalTarget, deleteSignalTarget, getSignalTarget, listSignalTargets,
  removeSignalInfraLink, signalTargetHistory, updateSignalTarget,
} from "../signal/repository.ts";
import {
  buildDemoConfiguredResources,
  buildDemoContainers,
  buildDemoExternalServiceHistory,
  buildDemoExternalServices,
  buildDemoHistory,
  buildDemoHosts,
  buildDemoMonitoringScope,
  buildDemoOverview,
  buildDemoPresentation,
  buildDemoProblems,
  buildDemoResourceConfigs,
  buildDemoSignalHistory,
  buildDemoSignalTargets,
  buildDemoStandaloneVpsDetail,
  buildDemoStandaloneVpsList,
  buildDemoTemplates,
  buildDemoVmWorkloads,
  isDemoMode,
} from "./demo-data.ts";

type Params<K extends string> = { params: Promise<Record<K, string>> };
const emptyQuery = z.strictObject({});
export function storagesGet(request: Request) {
  return protectedResponse(request, async () => { queryParams(request, emptyQuery); return readStorages(); });
}
export function storageGet(request: Request, context: Params<"storageKey">) {
  return protectedResponse(request, async () => { queryParams(request, emptyQuery); return readStorage(storageKeySchema.parse((await context.params).storageKey)); });
}
export function storageSettingsGet(request: Request) {
  return protectedResponse(request, async editor => {
    if (!editor) throw new BffError(403, "forbidden");
    queryParams(request, emptyQuery); return { data: await listStorageConfigs() };
  });
}
export function storageSettingsPut(request: Request, context: Params<"storageKey">) {
  return protectedResponse(request, async () => {
    queryParams(request, emptyQuery);
    return { data: await saveStorageConfig(storageKeySchema.parse((await context.params).storageKey), await jsonBody(request)) };
  });
}
const historyQuery = z.strictObject({ range: historyRangeSchema.default("1h") });

const demoEnv = <T>(data: T) => ({
  presentationStatus: "ready" as const,
  data,
  availability: "ready" as const,
  stale: false,
  lastUpdated: new Date().toISOString(),
  refreshAfterMs: 20000,
});

export function monitoringScopeGet(request: Request) {
  return protectedResponse(request, async () => {
    queryParams(request, emptyQuery);
    if (isDemoMode()) return buildDemoMonitoringScope();
    return readMonitoringScopeDocument();
  });
}
export function monitoringScopeLinkPost(request: Request) {
  return protectedResponse(request, async () => {
    queryParams(request, emptyQuery);
    const body = await jsonBody(request);
    if (isDemoMode()) return buildDemoMonitoringScope();
    return postMonitoringScopeLink(body);
  });
}
export function monitoringScopeLinkDelete(request: Request) {
  return protectedResponse(request, async () => {
    queryParams(request, emptyQuery);
    const body = await jsonBody(request);
    if (isDemoMode()) return buildDemoMonitoringScope();
    return deleteMonitoringScopeLink(body);
  });
}

export function vmConfigsGet(request: Request) {
  return protectedResponse(request, async () => {
    queryParams(request, emptyQuery);
    if (isDemoMode()) return { data: [] };
    return { data: await listVmConfigs() };
  });
}
export function vmConfigPut(request: Request, context: Params<"vmKey">) {
  return protectedResponse(request, async () => {
    queryParams(request, emptyQuery);
    const vmKey = vmKeySchema.parse((await context.params).vmKey);
    const body = await jsonBody(request) as Record<string, unknown>;
    if (isDemoMode()) return { data: { vmKey, hostKey: "ASGARD", displayName: (body.displayName as string | null) ?? null, revision: 1, updatedAt: new Date().toISOString() } };
    return { data: await saveVmConfig(vmKey, body) };
  });
}

export function resourceConfigsGet(request: Request) {
  return protectedResponse(request, async () => {
    queryParams(request, emptyQuery);
    if (isDemoMode()) return { data: buildDemoResourceConfigs() };
    return { data: await listResources() };
  });
}

export function templatesGet(request: Request) {
  return protectedResponse(request, async () => {
    const query = queryParams(request, z.strictObject({ hostKey: hostKeySchema.optional() }));
    if (isDemoMode()) return buildDemoTemplates();
    return readTemplates(query);
  });
}
export function templateGet(request: Request, context: Params<"templateKey">) {
  return protectedResponse(request, async () => {
    queryParams(request, emptyQuery);
    const key = templateKeySchema.parse((await context.params).templateKey);
    if (isDemoMode()) {
      const all = buildDemoTemplates();
      return { ...all, data: all.data.find(t => t.templateKey === key) ?? all.data[0] };
    }
    return readTemplates({ templateKey: key });
  });
}
export function templateConfigsGet(request: Request) {
  return protectedResponse(request, async () => {
    queryParams(request, emptyQuery);
    if (isDemoMode()) return { data: [] };
    return { data: await listTemplateConfigs() };
  });
}
export function templateConfigPut(request: Request, context: Params<"templateKey">) {
  return protectedResponse(request, async () => {
    queryParams(request, emptyQuery);
    const templateKey = templateKeySchema.parse((await context.params).templateKey);
    const body = await jsonBody(request) as Record<string, unknown>;
    if (isDemoMode()) {
      const tpl = buildDemoTemplates().data.find(t => t.templateKey === templateKey) ?? buildDemoTemplates().data[0];
      return {
        data: {
          templateKey,
          hostKey: tpl.hostKey,
          templateId: tpl.templateId ?? "901",
          originalName: tpl.technicalName,
          virtualizationType: tpl.virtualizationType ?? "qemu",
          displayName: (body.displayName as string | null) ?? null,
          roleOverride: (body.roleOverride as "worker" | "manager" | null) ?? null,
          revision: 1,
          updatedAt: new Date().toISOString(),
        },
      };
    }
    return { data: await saveTemplateConfig(templateKey, body) };
  });
}

export function presentationGet(request: Request) {
  return protectedResponse(request, async () => {
    queryParams(request, emptyQuery);
    if (isDemoMode()) return buildDemoPresentation();
    return getPresentation();
  });
}
export function presentationPut(request: Request) {
  return protectedResponse(request, async () => {
    queryParams(request, emptyQuery);
    const body = await jsonBody(request) as { settings?: Record<string, unknown>; expectedRevision?: number };
    if (isDemoMode()) {
      const current = buildDemoPresentation();
      return {
        data: { ...current.data, ...(body.settings ?? {}), revision: (body.expectedRevision ?? current.data.revision) + 1 },
        updatedAt: new Date().toISOString(),
      };
    }
    return savePresentation(body);
  });
}
export function overviewGet(request: Request) {
  return protectedResponse(request, async () => {
    const screenId = queryParams(request, z.strictObject({ screenId: uuidSchema.optional() })).screenId;
    if (isDemoMode()) return buildDemoOverview(screenId);
    return readOverview(screenId);
  });
}
export function hostsGet(request: Request) {
  return protectedResponse(request, async () => {
    queryParams(request, emptyQuery);
    if (isDemoMode()) return { ...demoEnv(buildDemoHosts()), asgardHostKey: "ASGARD" };
    return readHosts();
  });
}
export function hostGet(request: Request, context: Params<"hostKey">) {
  return protectedResponse(request, async () => {
    queryParams(request, emptyQuery);
    const key = hostKeySchema.parse((await context.params).hostKey);
    if (isDemoMode()) {
      const hosts = buildDemoHosts();
      return demoEnv(hosts.find(h => h.hostKey === key) ?? hosts[0]);
    }
    return readHost(key);
  });
}
export function containersGet(request: Request) {
  return protectedResponse(request, async () => {
    const hostKey = queryParams(request, z.strictObject({ hostKey: hostKeySchema.optional() })).hostKey;
    if (isDemoMode()) return demoEnv(buildDemoContainers(hostKey));
    return readContainers(hostKey);
  });
}
export function hostContainersGet(request: Request, context: Params<"hostKey">) {
  return protectedResponse(request, async () => {
    queryParams(request, emptyQuery);
    const hostKey = hostKeySchema.parse((await context.params).hostKey);
    if (isDemoMode()) return demoEnv(buildDemoContainers(hostKey));
    return readContainers(hostKey);
  });
}
export function vmContainersGet(request: Request, context: Params<"hostKey" | "vmKey">) {
  return protectedResponse(request, async () => {
    queryParams(request, emptyQuery);
    const params = await context.params;
    const hostKey = hostKeySchema.parse(params.hostKey);
    const vmKey = hostKeySchema.parse(params.vmKey);
    if (isDemoMode()) return buildDemoVmWorkloads(hostKey, vmKey);
    return readVmWorkloads(hostKey, vmKey, request.signal);
  });
}
export function problemsGet(request: Request) {
  return protectedResponse(request, async () => {
    queryParams(request, emptyQuery);
    if (isDemoMode()) return demoEnv(buildDemoProblems());
    return readProblems();
  });
}
export function servicesGet(request: Request) {
  return protectedResponse(request, async () => {
    queryParams(request, emptyQuery);
    if (isDemoMode()) return demoEnv(buildDemoConfiguredResources());
    return readServices();
  });
}
export function serviceGet(request: Request, context: Params<"id">) {
  return protectedResponse(request, async () => {
    queryParams(request, emptyQuery);
    const id = uuidSchema.parse((await context.params).id);
    if (isDemoMode()) {
      const list = buildDemoConfiguredResources();
      return demoEnv(list.find(r => r.id === id) ?? list[0]);
    }
    return readServices(id);
  });
}
export function servicePost(request: Request) {
  return protectedResponse(request, async () => {
    queryParams(request, emptyQuery);
    const { context, ...body } = z.object({ context: resourceContextSchema.optional() }).passthrough().parse(await jsonBody(request));
    if (isDemoMode()) {
      const now = new Date().toISOString();
      return { data: { ...buildDemoResourceConfigs()[0], ...body, id: crypto.randomUUID(), createdAt: now, updatedAt: now } };
    }
    return { data: await createResource(body, context) };
  }, 201);
}
export function servicePatch(request: Request, context: Params<"id">) {
  return protectedResponse(request, async () => {
    queryParams(request, emptyQuery);
    const id = uuidSchema.parse((await context.params).id);
    const { context: origin, ...body } = z.object({ context: resourceContextSchema.optional() }).passthrough().parse(await jsonBody(request));
    if (isDemoMode()) {
      const existing = buildDemoResourceConfigs().find(r => r.id === id) ?? buildDemoResourceConfigs()[0];
      return { data: { ...existing, ...body, id, updatedAt: new Date().toISOString() } };
    }
    return { data: await updateResource(id, body, origin) };
  });
}
export function serviceDelete(request: Request, context: Params<"id">) {
  return protectedResponse(request, async () => {
    queryParams(request, emptyQuery);
    const id = uuidSchema.parse((await context.params).id);
    if (isDemoMode()) return;
    return deleteResource(id);
  }, 204);
}
export function externalServicesGet(request: Request) {
  return protectedResponse(request, async editor => {
    queryParams(request, emptyQuery);
    const data = isDemoMode() ? buildDemoExternalServices() : await listExternalServicesWithUptime();
    return { data: editor ? data : data.map(service => {
      const { bodyTemplate, headerName, expectedValue, ...publicService } = service;
      void bodyTemplate; void headerName; void expectedValue;
      return publicService;
    }) };
  });
}
export function externalServicePost(request: Request) {
  return protectedResponse(request, async () => {
    queryParams(request, emptyQuery);
    const body = await jsonBody(request) as Record<string, unknown>;
    if (isDemoMode()) {
      const now = new Date().toISOString();
      return { data: { ...buildDemoExternalServices()[0], ...body, id: crypto.randomUUID(), revision: 1, createdAt: now, updatedAt: now } };
    }
    return { data: await createExternalService(body) };
  }, 201);
}
export function externalServicePatch(request: Request, context: Params<"id">) {
  return protectedResponse(request, async () => {
    queryParams(request, emptyQuery);
    const id = uuidSchema.parse((await context.params).id);
    const body = await jsonBody(request) as Record<string, unknown>;
    if (isDemoMode()) {
      const existing = buildDemoExternalServices().find(s => s.id === id) ?? buildDemoExternalServices()[0];
      return { data: { ...existing, ...body, id, revision: existing.revision + 1, updatedAt: new Date().toISOString() } };
    }
    return { data: await updateExternalService(id, body) };
  });
}
export function externalServiceDelete(request: Request, context: Params<"id">) {
  return protectedResponse(request, async () => {
    queryParams(request, emptyQuery);
    const id = uuidSchema.parse((await context.params).id);
    if (isDemoMode()) return;
    await deleteExternalService(id);
  }, 204);
}
export function standaloneVpsGet(request: Request) {
  return protectedResponse(request, async editor => {
    queryParams(request, emptyQuery);
    const data = isDemoMode() ? buildDemoStandaloneVpsList() : await listStandaloneVps();
    return { data: editor ? data : data.map(item => {
      const { apiKey, ...publicItem } = item;
      void apiKey;
      return publicItem;
    }) };
  });
}
export function standaloneVpsPost(request: Request) {
  return protectedResponse(request, async () => {
    queryParams(request, emptyQuery);
    const body = await jsonBody(request) as Record<string, unknown>;
    if (isDemoMode()) {
      const now = new Date().toISOString();
      return { data: { ...buildDemoStandaloneVpsList()[0], ...body, id: crypto.randomUUID(), revision: 1, createdAt: now, updatedAt: now } };
    }
    return { data: await createStandaloneVps(body) };
  }, 201);
}
export function standaloneVpsPatch(request: Request, context: Params<"id">) {
  return protectedResponse(request, async () => {
    queryParams(request, emptyQuery);
    const id = uuidSchema.parse((await context.params).id);
    const body = await jsonBody(request) as Record<string, unknown>;
    if (isDemoMode()) {
      const existing = buildDemoStandaloneVpsList().find(v => v.id === id) ?? buildDemoStandaloneVpsList()[0];
      return { data: { ...existing, ...body, id, revision: existing.revision + 1, updatedAt: new Date().toISOString() } };
    }
    return { data: await updateStandaloneVps(id, body) };
  });
}
export function standaloneVpsDelete(request: Request, context: Params<"id">) {
  return protectedResponse(request, async () => {
    queryParams(request, emptyQuery);
    const id = uuidSchema.parse((await context.params).id);
    if (isDemoMode()) return;
    await deleteStandaloneVps(id);
  }, 204);
}
export function standaloneVpsDetailGet(request: Request, context: Params<"id">) {
  return protectedResponse(request, async editor => {
    const query = queryParams(request, vpsDetailQuerySchema);
    const id = uuidSchema.parse((await context.params).id);
    const data = isDemoMode()
      ? buildDemoStandaloneVpsDetail(id, query.range)
      : await readStandaloneVps(id, { range: query.range, samples: query.samples === "1" });
    if (editor) return { data };
    const { apiKey, ...item } = data;
    void apiKey;
    return { data: item };
  });
}
export function vpsStackPost(request: Request, context: Params<"id">) {
  return protectedResponse(request, async () => {
    queryParams(request, emptyQuery);
    const vpsId = uuidSchema.parse((await context.params).id);
    const body = await jsonBody(request) as Record<string, unknown>;
    if (isDemoMode()) {
      const now = new Date().toISOString();
      return { data: { id: crypto.randomUUID(), vpsId, name: String(body.name ?? ""), link: (body.link as string | null) ?? null, notes: (body.notes as string | null) ?? null, createdAt: now, updatedAt: now } };
    }
    return { data: await createVpsStack(vpsId, body) };
  }, 201);
}
export function vpsStackPatch(request: Request, context: Params<"id" | "stackId">) {
  return protectedResponse(request, async () => {
    queryParams(request, emptyQuery);
    const route = await context.params;
    const vpsId = uuidSchema.parse(route.id);
    const stackId = uuidSchema.parse(route.stackId);
    const body = await jsonBody(request) as Record<string, unknown>;
    if (isDemoMode()) {
      const now = new Date().toISOString();
      return { data: { id: stackId, vpsId, name: String(body.name ?? ""), link: (body.link as string | null) ?? null, notes: (body.notes as string | null) ?? null, createdAt: now, updatedAt: now } };
    }
    return { data: await updateVpsStack(vpsId, stackId, body) };
  });
}
export function vpsStackDelete(request: Request, context: Params<"id" | "stackId">) {
  return protectedResponse(request, async () => {
    queryParams(request, emptyQuery);
    const route = await context.params;
    const vpsId = uuidSchema.parse(route.id);
    const stackId = uuidSchema.parse(route.stackId);
    if (isDemoMode()) return;
    await deleteVpsStack(vpsId, stackId);
  }, 204);
}
export function externalServiceHistoryGet(request: Request, context: Params<"id">) {
  return protectedResponse(request, async () => {
    const id = uuidSchema.parse((await context.params).id);
    const range = queryParams(request, z.strictObject({ range: externalServiceHistoryRangeSchema.default("24h") })).range;
    if (isDemoMode()) return { data: buildDemoExternalServiceHistory(id, range) };
    return { data: await externalServiceHistory(id, range) };
  });
}
export function signalTargetsGet(request: Request) {
  return protectedResponse(request, async () => {
    queryParams(request, emptyQuery);
    if (isDemoMode()) return { data: buildDemoSignalTargets() };
    return { data: await listSignalTargets() };
  });
}
export function signalTargetPost(request: Request) {
  return protectedResponse(request, async () => {
    queryParams(request, emptyQuery);
    const body = await jsonBody(request) as Record<string, unknown>;
    if (isDemoMode()) {
      const now = new Date().toISOString();
      return { data: { ...buildDemoSignalTargets()[0], ...body, id: crypto.randomUUID(), revision: 1, createdAt: now, updatedAt: now } };
    }
    return { data: await createSignalTarget(body) };
  }, 201);
}
export function signalTargetGet(request: Request, context: Params<"id">) {
  return protectedResponse(request, async () => {
    queryParams(request, emptyQuery);
    const id = uuidSchema.parse((await context.params).id);
    if (isDemoMode()) {
      const list = buildDemoSignalTargets();
      return { data: list.find(t => t.id === id) ?? list[0] };
    }
    return { data: await getSignalTarget(id) };
  });
}
export function signalTargetPatch(request: Request, context: Params<"id">) {
  return protectedResponse(request, async () => {
    queryParams(request, emptyQuery);
    const id = uuidSchema.parse((await context.params).id);
    const body = await jsonBody(request) as Record<string, unknown>;
    if (isDemoMode()) {
      const existing = buildDemoSignalTargets().find(t => t.id === id) ?? buildDemoSignalTargets()[0];
      return { data: { ...existing, ...body, id, revision: existing.revision + 1, updatedAt: new Date().toISOString() } };
    }
    return { data: await updateSignalTarget(id, body) };
  });
}
export function signalTargetDelete(request: Request, context: Params<"id">) {
  return protectedResponse(request, async () => {
    queryParams(request, emptyQuery);
    const id = uuidSchema.parse((await context.params).id);
    if (isDemoMode()) return;
    await deleteSignalTarget(id);
  }, 204);
}
export function signalTargetHistoryGet(request: Request, context: Params<"id">) {
  return protectedResponse(request, async () => {
    const id = uuidSchema.parse((await context.params).id);
    const range = queryParams(request, z.strictObject({ range: signalHistoryRangeSchema.default("24h") })).range;
    if (isDemoMode()) return { data: buildDemoSignalHistory(id, range) };
    return { data: await signalTargetHistory(id, range) };
  });
}
export function signalInfraLinkPost(request: Request, context: Params<"id">) {
  return protectedResponse(request, async () => {
    queryParams(request, emptyQuery);
    const id = uuidSchema.parse((await context.params).id);
    const body = await jsonBody(request) as Record<string, unknown>;
    if (isDemoMode()) {
      const existing = buildDemoSignalTargets().find(t => t.id === id) ?? buildDemoSignalTargets()[0];
      return { data: { ...existing, revision: existing.revision + 1 } };
    }
    return { data: await addSignalInfraLink(id, body) };
  }, 201);
}
export function signalInfraLinkDelete(request: Request, context: Params<"id" | "linkId">) {
  return protectedResponse(request, async () => {
    queryParams(request, emptyQuery);
    const route = await context.params;
    const id = uuidSchema.parse(route.id);
    const linkId = uuidSchema.parse(route.linkId);
    const body = await jsonBody(request);
    if (isDemoMode()) {
      const existing = buildDemoSignalTargets().find(t => t.id === id) ?? buildDemoSignalTargets()[0];
      return { data: { ...existing, links: existing.links.filter(l => l.id !== linkId), revision: existing.revision + 1 } };
    }
    return { data: await removeSignalInfraLink(id, linkId, body) };
  });
}
export function hostHistoryGet(request: Request, context: Params<"hostKey">) {
  return protectedResponse(request, async () => {
    const hostKey = hostKeySchema.parse((await context.params).hostKey);
    const range = queryParams(request, historyQuery).range;
    if (isDemoMode()) return buildDemoHistory({ type: "host", hostKey, reference: null }, range);
    return readHistory({ type: "host", hostKey, reference: null }, range, request.signal);
  });
}
export function vmHistoryGet(request: Request, context: Params<"hostKey" | "vmKey">) {
  return protectedResponse(request, async () => {
    const params = await context.params;
    const hostKey = hostKeySchema.parse(params.hostKey);
    const vmKey = hostKeySchema.parse(params.vmKey);
    const range = queryParams(request, historyQuery).range;
    if (isDemoMode()) return buildDemoHistory({ type: "vm", hostKey, reference: vmKey }, range);
    return readHistory({ type: "vm", hostKey, reference: vmKey }, range, request.signal);
  });
}
export function serviceHistoryGet(request: Request, context: Params<"id">) {
  return protectedResponse(request, async () => {
    const { range } = queryParams(request, historyQuery);
    const id = uuidSchema.parse((await context.params).id);
    if (isDemoMode()) return buildDemoHistory({ type: "configured_resource", hostKey: "ASGARD", reference: id }, range);
    const config = await getResource(id);
    return readHistory({ type: "configured_resource", hostKey: config.zabbixHostKey, reference: config.id }, range, request.signal);
  });
}
