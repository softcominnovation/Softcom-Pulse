import "server-only";
import { readNotificationRoute } from "../notifications/handlers.ts";
import { z } from "zod";
import { hostKeySchema, uuidSchema, historyRangeSchema } from "../../config/resources.ts";
import { getPresentation, getResource, listResources } from "../config/repository.ts";
import { requireSession } from "../auth/index.ts";
import { BffError, publicResponse, queryParams } from "../bff.ts";
import { readHosts, readHost, readProblems, readServices, readOverview, readHistory } from "./read.ts";
import { externalServiceHistoryRangeSchema } from "../../config/external-services.ts";
import { listExternalServicesWithUptime } from "../probe/overview.ts";
import { externalServiceHistory } from "../probe/repository.ts";
import { vpsDetailQuerySchema } from "../../config/standalone-vps.ts";
import { listStandaloneVps, readStandaloneVps } from "../vps/repository.ts";
import { signalHistoryRangeSchema } from "../../config/signal-targets.ts";
import { storageKeySchema } from "../../config/storages.ts";
import { storageViewSchema } from "../../storage/contracts.ts";
import { publicStorage } from "../../storage/presentation.ts";
import { readStorage, readStorages } from "./storages.ts";
import { getSignalTarget, listSignalTargets, signalServicesForAudience, signalTargetHistory } from "../signal/repository.ts";
import {
  buildDemoConfiguredResources,
  buildDemoExternalServiceHistory,
  buildDemoExternalServices,
  buildDemoHistory,
  buildDemoHosts,
  buildDemoOverview,
  buildDemoPresentation,
  buildDemoProblems,
  buildDemoResourceConfigs,
  buildDemoSignalHistory,
  buildDemoSignalTargets,
  buildDemoStandaloneVpsDetail,
  buildDemoStandaloneVpsList,
  isDemoMode,
} from "./demo-data.ts";

const emptyQuery = z.strictObject({});
const historyQuery = z.strictObject({ range: historyRangeSchema.default("1h") });

function hasAccessSession(request: Request) {
  try { requireSession(request); return true; } catch { return false; }
}
export function withoutProbeRecipe<T extends { bodyTemplate?: unknown; headerName?: unknown; expectedValue?: unknown }>(data: T[]) {
  return data.map(item => {
    const { bodyTemplate, headerName, expectedValue, ...service } = item;
    void bodyTemplate; void headerName; void expectedValue;
    return service;
  });
}
export function withoutVpsKey<T extends { apiKey?: unknown }>(data: T[]) {
  return data.map(item => {
    const { apiKey, ...next } = item;
    void apiKey;
    return next;
  });
}
/** Public surface never exposes the VPS address (list, detail, overview cards). */
export function withoutVpsAddress<T extends { ip: string }>(item: T): T {
  return { ...item, ip: "" };
}
/** Public VPS detail: no monitor key and no service stacks (notes may hold secrets). */
export function withoutVpsPrivate<T extends { apiKey?: unknown; stacks?: unknown }>(item: T) {
  const { apiKey, stacks, ...next } = item;
  void apiKey; void stacks;
  return { ...next, stacks: [] as const };
}
/** Manager URL is only for authenticated readers; anonymous public responses keep the field null. */
export function withManagerVisibility<T extends { managerUrl: string | null }>(item: T, authed: boolean): T {
  return authed ? item : { ...item, managerUrl: null };
}
function redactPublicOverviewIps<T extends {
  standaloneVps?: { ip: string }[];
  blocks: { type: string; data: unknown }[];
}>(overview: T): T {
  return {
    ...overview,
    standaloneVps: overview.standaloneVps?.map(withoutVpsAddress),
    blocks: overview.blocks.map(block => {
      if (block.type === "storage_summary" && block.data && typeof block.data === "object" && "target" in block.data) {
        const target = storageViewSchema.safeParse(block.data.target);
        return { ...block, data: { target: target.success ? publicStorage(target.data) : null } };
      }
      if (block.type !== "highlighted_resources" || !block.data || typeof block.data !== "object" || !("cards" in block.data) || !Array.isArray((block.data as { cards: unknown }).cards)) return block;
      const cards = (block.data as { cards: { kind: string; item: { ip?: string } }[] }).cards.map(card =>
        card.kind === "standalone_vps" && card.item && typeof card.item.ip === "string"
          ? { ...card, item: withoutVpsAddress(card.item as { ip: string }) }
          : card.kind === "storage" ? { ...card, item: publicStorage(storageViewSchema.parse(card.item)) } : card,
      );
      return { ...block, data: { ...(block.data as object), cards } };
    }),
  };
}

async function readPublic(request: Request, segments: string[]) {
  const [root, second, third, fourth, fifth, sixth] = segments;
  const authed = hasAccessSession(request);
  if (root === "monitoring" && second === "notifications") return readNotificationRoute(request, segments.slice(2), "public");
  if (root === "monitoring" && second === "storages" && segments.length === 2) { queryParams(request, emptyQuery); return readStorages({ publicRead: true }); }
  if (root === "monitoring" && second === "storages" && third && segments.length === 3) { queryParams(request, emptyQuery); return readStorage(storageKeySchema.parse(third), true); }
  if (isDemoMode()) {
    const now = new Date().toISOString();
    const env = <T>(data: T) => ({ presentationStatus: "ready" as const, data, availability: "ready" as const, stale: false, lastUpdated: now, refreshAfterMs: 20000 });
    if (root === "dashboard" && second === "overview" && segments.length === 2) {
      const overview = buildDemoOverview(queryParams(request, z.strictObject({ screenId: uuidSchema.optional() })).screenId);
      return {
        ...overview,
        data: redactPublicOverviewIps({
          ...overview.data,
          blocks: overview.data.blocks.map(block => block.type === "container_inventory"
            ? { ...block, data: null, availability: "unavailable" as const, stale: false, lastUpdated: null }
            : block),
        }),
      };
    }
    if (root === "settings" && second === "presentation" && segments.length === 2) { queryParams(request, emptyQuery); return buildDemoPresentation(); }
    if (root === "settings" && second === "resources" && segments.length === 2) { queryParams(request, emptyQuery); return { data: buildDemoResourceConfigs() }; }
    if (root !== "monitoring") throw new BffError(404, "not_found");
    if (second === "hosts" && segments.length === 2) {
      queryParams(request, emptyQuery);
      const hosts = buildDemoHosts();
      return { ...env(hosts), asgardHostKey: "ASGARD" };
    }
    if (second === "hosts" && third && segments.length === 3) {
      queryParams(request, emptyQuery);
      const key = hostKeySchema.parse(third);
      const host = buildDemoHosts().find(h => h.hostKey === key) ?? buildDemoHosts()[0];
      return env(host);
    }
    if (second === "hosts" && third && fourth === "history" && segments.length === 4) {
      return buildDemoHistory({ type: "host", hostKey: hostKeySchema.parse(third), reference: null }, queryParams(request, historyQuery).range);
    }
    if (second === "hosts" && third && fourth === "vms" && fifth && sixth === "history" && segments.length === 6) {
      return buildDemoHistory({ type: "vm", hostKey: hostKeySchema.parse(third), reference: hostKeySchema.parse(fifth) }, queryParams(request, historyQuery).range);
    }
    if (second === "problems" && segments.length === 2) { queryParams(request, emptyQuery); return env(buildDemoProblems()); }
    if (second === "services" && segments.length === 2) { queryParams(request, emptyQuery); return env(buildDemoConfiguredResources()); }
    if (second === "services" && third && segments.length === 3) {
      queryParams(request, emptyQuery);
      const id = uuidSchema.parse(third);
      const list = buildDemoConfiguredResources();
      return env(list.find(r => r.id === id) ?? list[0]);
    }
    if (second === "services" && third && fourth === "history" && segments.length === 4) {
      const { range } = queryParams(request, historyQuery);
      return buildDemoHistory({ type: "configured_resource", hostKey: "ASGARD", reference: uuidSchema.parse(third) }, range);
    }
    if (second === "external-services" && segments.length === 2) { queryParams(request, emptyQuery); return { data: withoutProbeRecipe(buildDemoExternalServices()) }; }
    if (second === "external-services" && third && fourth === "history" && segments.length === 4) {
      return { data: buildDemoExternalServiceHistory(uuidSchema.parse(third), queryParams(request, z.strictObject({ range: externalServiceHistoryRangeSchema.default("24h") })).range) };
    }
    if (second === "standalone-vps" && segments.length === 2) {
      queryParams(request, emptyQuery);
      return { data: withoutVpsKey(buildDemoStandaloneVpsList()).map(item => withManagerVisibility(withoutVpsAddress(item), authed)) };
    }
    if (second === "standalone-vps" && third && segments.length === 3) {
      const query = queryParams(request, vpsDetailQuerySchema);
      const data = buildDemoStandaloneVpsDetail(uuidSchema.parse(third), query.range);
      return { data: withManagerVisibility(withoutVpsAddress(withoutVpsPrivate(data)), authed) };
    }
    if (second === "signal-targets" && segments.length === 2) { queryParams(request, emptyQuery); return { data: buildDemoSignalTargets() }; }
    if (second === "signal-targets" && third && segments.length === 3) {
      queryParams(request, emptyQuery);
      const id = uuidSchema.parse(third);
      const list = buildDemoSignalTargets();
      return { data: list.find(t => t.id === id) ?? list[0] };
    }
    if (second === "signal-targets" && third && fourth === "history" && segments.length === 4) {
      return { data: buildDemoSignalHistory(uuidSchema.parse(third), queryParams(request, z.strictObject({ range: signalHistoryRangeSchema.default("24h") })).range) };
    }
    throw new BffError(404, "not_found");
  }
  if (root === "dashboard" && second === "overview" && segments.length === 2) {
    const overview = await readOverview(queryParams(request, z.strictObject({ screenId: uuidSchema.optional() })).screenId);
    return {
      ...overview,
      data: redactPublicOverviewIps({
        ...overview.data,
        blocks: overview.data.blocks.map(block => block.type === "container_inventory"
          ? { ...block, data: null, availability: "unavailable" as const, stale: false, lastUpdated: null }
          : block),
      }),
    };
  }
  if (root === "settings" && second === "presentation" && segments.length === 2) { queryParams(request, emptyQuery); return getPresentation(); }
  if (root === "settings" && second === "resources" && segments.length === 2) { queryParams(request, emptyQuery); return { data: await listResources() }; }
  if (root !== "monitoring") throw new BffError(404, "not_found");
  if (second === "hosts" && segments.length === 2) { queryParams(request, emptyQuery); return readHosts(); }
  if (second === "hosts" && third && segments.length === 3) { queryParams(request, emptyQuery); return readHost(hostKeySchema.parse(third)); }
  if (second === "hosts" && third && fourth === "history" && segments.length === 4) return readHistory({ type: "host", hostKey: hostKeySchema.parse(third), reference: null }, queryParams(request, historyQuery).range, request.signal);
  if (second === "hosts" && third && fourth === "vms" && fifth && sixth === "history" && segments.length === 6) return readHistory({ type: "vm", hostKey: hostKeySchema.parse(third), reference: hostKeySchema.parse(fifth) }, queryParams(request, historyQuery).range, request.signal);
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
    return { data: withoutVpsKey(await listStandaloneVps()).map(item => withManagerVisibility(withoutVpsAddress(item), authed)) };
  }
  if (second === "standalone-vps" && third && segments.length === 3) {
    const query = queryParams(request, vpsDetailQuerySchema);
    const data = await readStandaloneVps(uuidSchema.parse(third), { range: query.range, samples: query.samples === "1" });
    return { data: withManagerVisibility(withoutVpsAddress(withoutVpsPrivate(data)), authed) };
  }
  if (second === "signal-targets" && segments.length === 2) {
    queryParams(request, emptyQuery);
    return { data: (await listSignalTargets()).map(item => signalServicesForAudience(item, false)) };
  }
  if (second === "signal-targets" && third && segments.length === 3) {
    queryParams(request, emptyQuery);
    return { data: signalServicesForAudience(await getSignalTarget(uuidSchema.parse(third)), false) };
  }
  if (second === "signal-targets" && third && fourth === "history" && segments.length === 4) {
    return {
      data: await signalTargetHistory(
        uuidSchema.parse(third),
        queryParams(request, z.strictObject({ range: signalHistoryRangeSchema.default("24h") })).range,
      ),
    };
  }
  if (second === "signal-targets" && third && fourth === "services" && fifth && segments.length === 5) {
    queryParams(request, emptyQuery);
    const target = await getSignalTarget(uuidSchema.parse(third));
    const service = target.enabled ? target.services.find(item => item.id === fifth && item.enabled) : undefined;
    if (!service) throw new BffError(404, "not_found");
    return { data: service };
  }
  throw new BffError(404, "not_found");
}

export function publicGet(request: Request, segments: string[]) {
  return publicResponse(request, () => readPublic(request, segments));
}
export function publicRouteGet(request: Request, context: { params: Promise<{ path: string[] }> }) {
  return context.params.then(params => publicGet(request, params.path));
}
