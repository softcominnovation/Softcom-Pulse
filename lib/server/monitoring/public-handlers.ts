import "server-only";
import { z } from "zod";
import { hostKeySchema, uuidSchema, historyRangeSchema } from "../../config/resources.ts";
import { getPresentation, getResource, listResources } from "../config/repository.ts";
import { requireSession } from "../auth/index.ts";
import { BffError, publicResponse, queryParams } from "../bff.ts";
import { readHosts, readHost, readContainers, readProblems, readServices, readOverview, readHistory } from "./read.ts";
import { readVmWorkloads } from "./vm-workloads.ts";
import { externalServiceHistoryRangeSchema } from "../../config/external-services.ts";
import { listExternalServicesWithUptime } from "../probe/overview.ts";
import { externalServiceHistory } from "../probe/repository.ts";
import { vpsDetailQuerySchema } from "../../config/standalone-vps.ts";
import { listStandaloneVps, readStandaloneVps } from "../vps/repository.ts";
import { signalHistoryRangeSchema } from "../../config/signal-targets.ts";
import { getSignalTarget, listSignalTargets, signalTargetHistory } from "../signal/repository.ts";

const emptyQuery = z.strictObject({});
const historyQuery = z.strictObject({ range: historyRangeSchema.default("1h") });

function hasAccessSession(request: Request) {
  try { requireSession(request); return true; } catch { return false; }
}
export function withoutProbeRecipe<T extends { bodyTemplate: unknown; headerName: unknown; expectedValue: unknown }>(data: T[]) {
  return data.map(item => {
    const { bodyTemplate, headerName, expectedValue, ...service } = item;
    void bodyTemplate; void headerName; void expectedValue;
    return service;
  });
}
export function withoutVpsKey<T extends { apiKey: unknown }>(data: T[]) {
  return data.map(item => {
    const { apiKey, ...next } = item;
    void apiKey;
    return next;
  });
}
/** Public VPS detail: no monitor key and no service stacks (notes may hold secrets). */
export function withoutVpsPrivate<T extends { apiKey: unknown; stacks?: unknown }>(item: T) {
  const { apiKey, stacks, ...next } = item;
  void apiKey; void stacks;
  return { ...next, stacks: [] as const };
}
/** Manager URL is only for authenticated readers; anonymous public responses keep the field null. */
export function withManagerVisibility<T extends { managerUrl: string | null }>(item: T, authed: boolean): T {
  return authed ? item : { ...item, managerUrl: null };
}

async function readPublic(request: Request, segments: string[]) {
  const [root, second, third, fourth, fifth, sixth] = segments;
  const authed = hasAccessSession(request);
  if (root === "dashboard" && second === "overview" && segments.length === 2) {
    return readOverview(queryParams(request, z.strictObject({ screenId: uuidSchema.optional() })).screenId);
  }
  if (root === "settings" && second === "presentation" && segments.length === 2) { queryParams(request, emptyQuery); return getPresentation(); }
  if (root === "settings" && second === "resources" && segments.length === 2) { queryParams(request, emptyQuery); return { data: await listResources() }; }
  if (root !== "monitoring") throw new BffError(404, "not_found");
  if (second === "hosts" && segments.length === 2) { queryParams(request, emptyQuery); return readHosts(); }
  if (second === "hosts" && third && segments.length === 3) { queryParams(request, emptyQuery); return readHost(hostKeySchema.parse(third)); }
  if (second === "hosts" && third && fourth === "containers" && segments.length === 4) { queryParams(request, emptyQuery); return readContainers(hostKeySchema.parse(third)); }
  if (second === "hosts" && third && fourth === "history" && segments.length === 4) return readHistory({ type: "host", hostKey: hostKeySchema.parse(third), reference: null }, queryParams(request, historyQuery).range, request.signal);
  if (second === "hosts" && third && fourth === "vms" && fifth && sixth === "history" && segments.length === 6) return readHistory({ type: "vm", hostKey: hostKeySchema.parse(third), reference: hostKeySchema.parse(fifth) }, queryParams(request, historyQuery).range, request.signal);
  if (second === "hosts" && third && fourth === "vms" && fifth && sixth === "containers" && segments.length === 6) { queryParams(request, emptyQuery); return readVmWorkloads(hostKeySchema.parse(third), hostKeySchema.parse(fifth), request.signal); }
  if (second === "containers" && segments.length === 2) return readContainers(queryParams(request, z.strictObject({ hostKey: hostKeySchema.optional() })).hostKey);
  if (second === "problems" && segments.length === 2) { queryParams(request, emptyQuery); return readProblems(); }
  if (second === "services" && segments.length === 2) { queryParams(request, emptyQuery); return readServices(); }
  if (second === "services" && third && segments.length === 3) { queryParams(request, emptyQuery); return readServices(uuidSchema.parse(third)); }
  if (second === "services" && third && fourth === "history" && segments.length === 4) {
    const { range } = queryParams(request, historyQuery);
    const config = await getResource(uuidSchema.parse(third));
    return readHistory({ type: "configured_resource", hostKey: config.zabbixHostKey, reference: config.id }, range, request.signal);
  }
  if (second === "external-services" && segments.length === 2) { queryParams(request, emptyQuery); return { data: withoutProbeRecipe(await listExternalServicesWithUptime()) }; }
  if (second === "external-services" && third && fourth === "history" && segments.length === 4) return { data: await externalServiceHistory(uuidSchema.parse(third), queryParams(request, z.strictObject({ range: externalServiceHistoryRangeSchema.default("24h") })).range) };
  if (second === "standalone-vps" && segments.length === 2) {
    queryParams(request, emptyQuery);
    return { data: withoutVpsKey(await listStandaloneVps()).map(item => withManagerVisibility(item, authed)) };
  }
  if (second === "standalone-vps" && third && segments.length === 3) {
    const query = queryParams(request, vpsDetailQuerySchema);
    const data = await readStandaloneVps(uuidSchema.parse(third), { range: query.range, samples: query.samples === "1" });
    return { data: withManagerVisibility(withoutVpsPrivate(data), authed) };
  }
  if (second === "signal-targets" && segments.length === 2) {
    queryParams(request, emptyQuery);
    return { data: await listSignalTargets() };
  }
  if (second === "signal-targets" && third && segments.length === 3) {
    queryParams(request, emptyQuery);
    return { data: await getSignalTarget(uuidSchema.parse(third)) };
  }
  if (second === "signal-targets" && third && fourth === "history" && segments.length === 4) {
    return {
      data: await signalTargetHistory(
        uuidSchema.parse(third),
        queryParams(request, z.strictObject({ range: signalHistoryRangeSchema.default("24h") })).range,
      ),
    };
  }
  throw new BffError(404, "not_found");
}

export function publicGet(request: Request, segments: string[]) {
  return publicResponse(request, () => readPublic(request, segments));
}
export function publicRouteGet(request: Request, context: { params: Promise<{ path: string[] }> }) {
  return context.params.then(params => publicGet(request, params.path));
}
