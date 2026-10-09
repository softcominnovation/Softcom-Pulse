import "server-only";
import type { ProbeCard } from "../../monitoring/contracts.ts";
import { listExternalServices, visualStrips } from "./repository.ts";
import { readProbeResults } from "./store.ts";

const emptyUptime = { reason: null, latencyMs: null, checkedAt: null, uptime24h: null, strip: [] as number[] };
function shownStrip(enabled: boolean, strip: number[] | undefined) {
  return enabled ? strip ?? [] : [];
}
export async function listExternalServicesWithUptime() {
  const services = await listExternalServices();
  const results = await readProbeResults(services.map(service => service.id)).catch(() => new Map());
  const strips = await visualStrips(services.filter(service => service.enabled).map(service => service.id)).catch(() => new Map<string, number[]>());
  return services.map(service => {
    const result = results.get(service.id);
    const uptime24h = result?.uptime24h && result.uptime24h.total > 0 ? result.uptime24h : null;
    return { ...service, uptime: result ? { reason: result.reason, latencyMs: result.latencyMs, checkedAt: result.checkedAt, uptime24h, strip: shownStrip(service.enabled, strips.get(service.id)) } : { ...emptyUptime, strip: shownStrip(service.enabled, strips.get(service.id)) } };
  });
}
export async function readProbeOverview(includeBoard: boolean) {
  const services = await listExternalServices();
  const visible = services.filter(service => service.enabled || service.dashboardEnabled);
  const results = await readProbeResults((includeBoard ? services : visible).map(service => service.id));
  const strips = await visualStrips(services.filter(service => service.enabled).map(service => service.id)).catch(() => new Map<string, number[]>());
  const card = (service: typeof services[number]): ProbeCard => {
    const result = results.get(service.id);
    // Overview/modal strip use at most 40 bars; history points load only when the modal opens.
    return {
      id: service.id, displayName: service.displayName, description: service.description, serviceType: service.serviceType, displayOrder: service.displayOrder,
      critical: service.critical, dashboardEnabled: service.dashboardEnabled, paused: !service.enabled, progressStartedAt: service.progressStartedAt,
      reason: result?.reason ?? null, latencyMs: result?.latencyMs ?? null, checkedAt: null, httpStatus: null,
      certNotAfter: result?.certNotAfter ?? null, uptime24h: result?.uptime24h ?? null, strip: shownStrip(service.enabled, strips.get(service.id)),
    };
  };
  return { externalServices: services.filter(service => service.dashboardEnabled).map(card), uptimeBoard: includeBoard ? services.filter(service => service.enabled).map(card) : [] };
}
