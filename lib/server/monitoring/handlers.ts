import "server-only";
import { z } from "zod";
import { hostKeySchema, uuidSchema, historyRangeSchema } from "../../config/resources.ts";
import { createResource, updateResource, deleteResource, getPresentation, savePresentation, getResource } from "../config/repository.ts";
import { jsonBody, protectedResponse, queryParams } from "../bff.ts";
import { readHosts, readHost, readContainers, readProblems, readServices, readOverview, readHistory } from "./read.ts";
import { templateKeySchema } from "../../config/templates.ts";
import { listTemplateConfigs, saveTemplateConfig } from "../config/templates.ts";
import { readTemplates } from "./templates.ts";
import { readVmWorkloads } from "./vm-workloads.ts";

type Params<K extends string> = { params: Promise<Record<K, string>> };
const emptyQuery = z.strictObject({});
const historyQuery = z.strictObject({ range: historyRangeSchema.default("1h") });

export function templatesGet(request: Request) {
  return protectedResponse(request, async () => readTemplates(queryParams(request, z.strictObject({ hostKey: hostKeySchema.optional() }))));
}
export function templateGet(request: Request, context: Params<"templateKey">) {
  return protectedResponse(request, async () => { queryParams(request, emptyQuery); return readTemplates({ templateKey: templateKeySchema.parse((await context.params).templateKey) }); });
}
export function templateConfigsGet(request: Request) {
  return protectedResponse(request, async () => { queryParams(request, emptyQuery); return { data: await listTemplateConfigs() }; });
}
export function templateConfigPut(request: Request, context: Params<"templateKey">) {
  return protectedResponse(request, async () => { queryParams(request, emptyQuery); return { data: await saveTemplateConfig(templateKeySchema.parse((await context.params).templateKey), await jsonBody(request)) }; });
}

export function presentationGet(request: Request) {
  return protectedResponse(request, async () => { queryParams(request, emptyQuery); return getPresentation(); });
}
export function presentationPut(request: Request) {
  return protectedResponse(request, async () => { queryParams(request, emptyQuery); return savePresentation(await jsonBody(request)); });
}
export function overviewGet(request: Request) {
  return protectedResponse(request, async () => readOverview(queryParams(request, z.strictObject({ screenId: uuidSchema.optional() })).screenId));
}
export function hostsGet(request: Request) {
  return protectedResponse(request, async () => { queryParams(request, emptyQuery); return readHosts(); });
}
export function hostGet(request: Request, context: Params<"hostKey">) {
  return protectedResponse(request, async () => { queryParams(request, emptyQuery); return readHost(hostKeySchema.parse((await context.params).hostKey)); });
}
export function containersGet(request: Request) {
  return protectedResponse(request, async () => readContainers(queryParams(request, z.strictObject({ hostKey: hostKeySchema.optional() })).hostKey));
}
export function hostContainersGet(request: Request, context: Params<"hostKey">) {
  return protectedResponse(request, async () => { queryParams(request, emptyQuery); return readContainers(hostKeySchema.parse((await context.params).hostKey)); });
}
export function vmContainersGet(request: Request, context: Params<"hostKey" | "vmKey">) {
  return protectedResponse(request, async () => {
    queryParams(request, emptyQuery);
    const params = await context.params;
    return readVmWorkloads(hostKeySchema.parse(params.hostKey), hostKeySchema.parse(params.vmKey), request.signal);
  });
}
export function problemsGet(request: Request) {
  return protectedResponse(request, async () => { queryParams(request, emptyQuery); return readProblems(); });
}
export function servicesGet(request: Request) {
  return protectedResponse(request, async () => { queryParams(request, emptyQuery); return readServices(); });
}
export function serviceGet(request: Request, context: Params<"id">) {
  return protectedResponse(request, async () => { queryParams(request, emptyQuery); return readServices(uuidSchema.parse((await context.params).id)); });
}
export function servicePost(request: Request) {
  return protectedResponse(request, async () => { queryParams(request, emptyQuery); return { data: await createResource(await jsonBody(request)) }; }, 201);
}
export function servicePatch(request: Request, context: Params<"id">) {
  return protectedResponse(request, async () => { queryParams(request, emptyQuery); return { data: await updateResource(uuidSchema.parse((await context.params).id), await jsonBody(request)) }; });
}
export function serviceDelete(request: Request, context: Params<"id">) {
  return protectedResponse(request, async () => { queryParams(request, emptyQuery); return deleteResource(uuidSchema.parse((await context.params).id)); }, 204);
}
export function hostHistoryGet(request: Request, context: Params<"hostKey">) {
  return protectedResponse(request, async () => readHistory({ type: "host", hostKey: hostKeySchema.parse((await context.params).hostKey), reference: null }, queryParams(request, historyQuery).range, request.signal));
}
export function vmHistoryGet(request: Request, context: Params<"hostKey" | "vmKey">) {
  return protectedResponse(request, async () => {
    const params = await context.params;
    return readHistory({ type: "vm", hostKey: hostKeySchema.parse(params.hostKey), reference: hostKeySchema.parse(params.vmKey) }, queryParams(request, historyQuery).range, request.signal);
  });
}
export function serviceHistoryGet(request: Request, context: Params<"id">) {
  return protectedResponse(request, async () => {
    const { range } = queryParams(request, historyQuery);
    const config = await getResource(uuidSchema.parse((await context.params).id));
    return readHistory({ type: "configured_resource", hostKey: config.zabbixHostKey, reference: config.id }, range, request.signal);
  });
}
