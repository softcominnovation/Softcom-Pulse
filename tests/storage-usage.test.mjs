import test from "node:test";
import assert from "node:assert/strict";
import { storagePreferencesSchema, storageWriteSchema } from "../lib/config/storages.ts";
import { storageUsageObservation } from "../lib/server/notifications/storage-usage.ts";
import { storageUsageRule } from "../lib/server/notifications/usage-rule.ts";
import { filesystemCapacity } from "../lib/monitoring/filesystem-capacity.ts";
import { notificationText } from "../lib/notifications/contracts.ts";
import { evaluateUsage } from "../lib/notifications/usage.ts";

const at = Date.now() - 120000, key = "sfs-" + "1".repeat(32), other = "sfs-" + "2".repeat(32);
function fixture() {
  const metric = value => ({ value, unit: "bytes", quality: "fresh", observedAt: new Date(at).toISOString(), validUntil: new Date(at + 600000).toISOString() });
  const volumes = [{ key, name: "/", metrics: { diskUsedBytes: metric(80), diskTotalBytes: metric(100) } }, { key: other, name: "/data", metrics: { diskUsedBytes: metric(20), diskTotalBytes: metric(400) } }];
  const target = { ref: "storage:test", kind: "storage", epoch: "epoch", identity: { hostId: "77", storageKey: "storage-key", diskWarningPercent: 70, filesystemKeys: [key], independentVolumesConfirmed: false } };
  const snapshot = { status: "ok", absent: [], items: [{ hostid: "77", storageKey: "storage-key", monitoringEnabled: true, volumes, classification: { validUntil: new Date(at + 600000).toISOString() } }] };
  return { target, snapshot, volumes };
}
test("Storage disk warning defaults off, validates limits/selection and preserves omission for legacy clients", () => {
  assert.equal(storagePreferencesSchema.parse({}).diskWarningPercent, null);
  assert.equal(storageWriteSchema.parse({ expectedRevision: 0 }).diskWarningPercent, undefined);
  for (const value of [0, 101, 70.5, "70"]) assert.equal(storageWriteSchema.safeParse({ expectedRevision: 0, diskWarningPercent: value, filesystemKeys: [key] }).success, false);
  assert.equal(storageWriteSchema.safeParse({ expectedRevision: 0, diskWarningPercent: 70 }).success, false);
  assert.equal(storageWriteSchema.safeParse({ expectedRevision: 0, diskWarningPercent: 70, filesystemKeys: [key, other] }).success, false);
  assert.equal(storageWriteSchema.parse({ expectedRevision: 0, diskWarningPercent: 70, filesystemKeys: [key] }).diskWarningPercent, 70);
});
test("Storage warning uses the exact weighted card capacity and a stable configuration fingerprint", () => {
  const { target, snapshot, volumes } = fixture();
  Object.assign(target.identity, { filesystemKeys: [key, other], independentVolumesConfirmed: true });
  const row = storageUsageObservation(target, snapshot, at);
  assert.equal(row.usage.value, 20);
  assert.equal(row.usage.value, filesystemCapacity(volumes, target.identity).usagePercent.value);
  assert.equal(row.usage.rule, storageUsageRule({ ...target.identity, filesystemKeys: [other, key] }));
  assert.equal(row.usage.token, storageUsageObservation({ ...target, identity: { ...target.identity, filesystemKeys: [other, key] } }, snapshot, at).usage.token);
  assert.notEqual(row.usage.rule, storageUsageRule({ ...target.identity, diskWarningPercent: 80 }));
  assert.match(notificationText({ ...row, targetRef: target.ref }), /^Disco do Storage em 20%/);
});
test("Storage warning needs distinct evidence for 30 seconds and never counts republished snapshots twice", () => {
  const { target, snapshot, volumes } = fixture();
  const first = storageUsageObservation(target, snapshot, at).usage;
  let evaluation = evaluateUsage(undefined, first, at);
  const repeated = storageUsageObservation(target, snapshot, at + 31000).usage;
  evaluation = evaluateUsage(evaluation.checkpoint, repeated, at + 31000);
  assert.equal(evaluation.state, "unknown");
  volumes[0].metrics.diskUsedBytes.observedAt = new Date(at + 31000).toISOString();
  const next = storageUsageObservation(target, snapshot, at + 31000).usage;
  evaluation = evaluateUsage(evaluation.checkpoint, next, at + 31000);
  assert.equal(evaluation.state, "unavailable");
  assert.equal(next.sampleAt, at + 31000);
});
test("Storage missing, stale, failed or expired capacity cannot open or recover a warning", () => {
  for (const mutate of [f => f.snapshot.items[0].volumes.splice(0, 1), f => f.volumes[0].metrics.diskUsedBytes.quality = "stale", f => f.snapshot.status = "failed", f => f.snapshot.items[0].classification.validUntil = new Date(at - 1).toISOString(), f => f.volumes[0].metrics.diskTotalBytes.value = 0]) {
    const f = fixture(); mutate(f); const row = storageUsageObservation(f.target, f.snapshot, at);
    assert.equal(row.usage.value, null); assert.equal(row.observation.state, "unknown");
  }
  const f = fixture(); f.target.identity.diskWarningPercent = null;
  assert.equal(storageUsageObservation(f.target, f.snapshot, at), null);
});
test("removing role=storage or disabling monitoring suppresses the disk condition", () => {
  const f = fixture(); f.snapshot.items[0].monitoringEnabled = false;
  assert.equal(storageUsageObservation(f.target, f.snapshot, at).observation.state, "suppressed");
  f.snapshot.items = []; f.snapshot.absent = [{ hostid: "77", resolution: "tag_missing" }];
  assert.equal(storageUsageObservation(f.target, f.snapshot, at).observation.state, "suppressed");
});
