import { createHash } from "node:crypto";
import { agentMonitoring, type CardMetric } from "../../config/agent-monitoring.ts";
export function usageRule(value: unknown, metric: CardMetric) {
  const config = agentMonitoring(value);
  return createHash("sha256").update(JSON.stringify(config ? {
    binding: [config.vmBinding.parentHostKey, config.vmBinding.vmKey], limit: config.thresholds[metric],
    capacity: metric === "disk" ? [config.capacity.filesystemKeys.slice().sort(), config.capacity.independentVolumesConfirmed] : null,
  } : null)).digest("hex");
}
export function storageUsageRule(identity: Record<string, unknown>) {
  return createHash("sha256").update(JSON.stringify({ hostId: identity.hostId, limit: identity.diskWarningPercent ?? null,
    volumes: Array.isArray(identity.filesystemKeys) ? [...identity.filesystemKeys].sort() : null,
    independent: identity.independentVolumesConfirmed === true,
  })).digest("hex");
}
