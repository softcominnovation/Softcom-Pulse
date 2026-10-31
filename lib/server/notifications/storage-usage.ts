import "server-only";
import type { StorageSnapshot } from "../../storage/contracts.ts";
import { filesystemCapacity } from "../../monitoring/filesystem-capacity.ts";
import { recoveryLimit } from "../../notifications/usage.ts";
import { storageUsageRule } from "./usage-rule.ts";
import { safelyRecordNotifications, type NotificationObservation } from "./engine.ts";
import type { NotificationTarget } from "./targets.ts";

export function storageUsageObservation(target: NotificationTarget, snapshot: StorageSnapshot, checkedAt: number): NotificationObservation | null {
  const limit = target.identity.diskWarningPercent, keys = target.identity.filesystemKeys;
  if (target.kind !== "storage" || typeof limit !== "number" || !Number.isInteger(limit) || limit < 1 || limit > 100 || !Array.isArray(keys) || !keys.length || !keys.every((key): key is string => typeof key === "string")) return null;
  const selectedKeys = [...keys].sort();
  const item = snapshot.items.find(item => item.hostid === target.identity.hostId && item.storageKey === target.identity.storageKey);
  const suppressed = snapshot.status === "ok" && (item?.monitoringEnabled === false || snapshot.absent.some(item => item.hostid === target.identity.hostId && item.resolution === "tag_missing"));
  const capacity = filesystemCapacity(item?.volumes ?? [], { filesystemKeys: selectedKeys, independentVolumesConfirmed: target.identity.independentVolumesConfirmed === true });
  const metric = capacity.usagePercent;
  const operands = selectedKeys.flatMap(key => {
    const volume = item?.volumes.find(volume => volume.key === key);
    return volume ? [volume.metrics.diskUsedBytes, volume.metrics.diskTotalBytes].filter(value => value !== undefined) : [];
  });
  const sampleAt = Math.max(0, ...operands.map(value => Date.parse(value.sampleObservedAt ?? value.observedAt ?? "") || 0));
  const valid = !suppressed && snapshot.status === "ok" && !!item?.classification.validUntil && Date.parse(item.classification.validUntil) > checkedAt && capacity.coverage === "complete" && metric?.quality === "fresh" && !!metric.validUntil && Date.parse(metric.validUntil) > checkedAt;
  return {
    key: "metric:disk", family: "metrics", source: "zabbix", eventType: "usage", messageCode: "usage_disk",
    observation: { epoch: target.epoch, fingerprint: `metric:disk:${sampleAt}`, checkedAt, observedAt: sampleAt, validUntil: metric?.validUntil ? Date.parse(metric.validUntil) : 0,
      state: suppressed ? "suppressed" : "unknown", severity: "warning", sourceSeverity: null, confirmation: "explicit" },
    usage: { metric: "disk", limit, rule: storageUsageRule(target.identity), scopeRevision: 0, sampleAt,
      token: JSON.stringify(operands.map(value => [value.sampleObservedAt ?? value.observedAt, value.value])), value: valid ? metric!.value : null, validUntil: metric?.validUntil ? Date.parse(metric.validUntil) : 0 },
    metricContext: valid ? { metric: "disk", valuePercent: metric!.value!, thresholdPercent: limit, recoveryPercent: recoveryLimit(limit), source: "agent", observedAt: metric!.observedAt!, coverage: `Volumes monitorados · ${keys.length}` } : undefined,
  };
}
export async function recordStorageUsage(targets: NotificationTarget[], snapshot: StorageSnapshot, checkedAt: number, parentSignal?: AbortSignal) {
  const signal = AbortSignal.any([AbortSignal.timeout(2200), ...(parentSignal ? [parentSignal] : [])]);
  for (const target of targets) {
    if (signal.aborted) return;
    const row = storageUsageObservation(target, snapshot, checkedAt);
    if (row) await safelyRecordNotifications(target, [row], [], signal);
  }
}
