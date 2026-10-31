import "server-only";
import { getPrisma } from "../prisma.ts";
import type { Host } from "../../monitoring/contracts.ts";
import { agentMonitoring, cardMetricsSchema } from "../../config/agent-monitoring.ts";
import { agentCapacity, agentBindingValid } from "../../monitoring/agent-monitoring.ts";

export async function withAgentCards(hosts: Host[]): Promise<Host[]> {
  const configs = await getPrisma().monitoredResourceConfig.findMany({ where: { resourceType: "host", zabbixHostKey: { in: hosts.filter(host => host.role === "linux").map(host => host.hostKey) } } });
  return hosts.map(host => {
    const config = configs.find(config => config.zabbixHostKey === host.hostKey);
    const settings = agentMonitoring(config?.agentMonitoring);
    if (!settings || !agentBindingValid(host.hostKey, settings, hosts)) return host;
    const presentation = config?.presentation as Record<string, unknown>;
    return { ...host, agentCard: { capacity: agentCapacity(host, settings), cardMetrics: cardMetricsSchema.safeParse(presentation.cardMetrics).data, metricsSource: presentation.metricsSource === "agent" ? "agent" : presentation.metricsSource === "auto" ? "auto" : "hypervisor" } };
  });
}
