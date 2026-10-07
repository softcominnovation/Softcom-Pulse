import "server-only";
import type { ProbeCard } from "../../monitoring/contracts.ts";
import { listExternalServices } from "./repository.ts";
import { readProbeResults } from "./store.ts";

export async function readProbeOverview(includeBoard: boolean) {
  const services = (await listExternalServices()).filter(service => service.enabled);
  const results = await readProbeResults(services.map(service => service.id));
  const card = (service: typeof services[number]): ProbeCard => {
    const result = results.get(service.id);
    return {
      id: service.id, displayName: service.displayName, description: service.description, serviceType: service.serviceType, displayOrder: service.displayOrder,
      critical: service.critical, dashboardEnabled: service.dashboardEnabled, reason: result?.reason ?? null, latencyMs: result?.latencyMs ?? null,
      checkedAt: result?.checkedAt ?? null, httpStatus: result?.httpStatus ?? null, certNotAfter: result?.certNotAfter ?? null, uptime24h: result?.uptime24h ?? null, strip: result?.strip ?? [],
    };
  };
  return { externalServices: services.filter(service => service.dashboardEnabled).map(card), uptimeBoard: includeBoard ? services.map(card) : [] };
}
