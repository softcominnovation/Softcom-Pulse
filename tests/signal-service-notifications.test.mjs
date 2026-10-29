import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { recordSignalServiceNotifications } from "../lib/server/notifications/signal-service.ts";

const epoch = "00000000-0000-4000-8000-000000000001";
const target = { ref: "signal_service:svc", id: "svc", kind: "signal_service", label: "Postgres", critical: true, enabled: true, epoch, identity: { targetId: "parent", servicePrefix: "softcom-signal-staging_postgres" } };
const scope = {
  services: [{ id: "svc", targetId: "parent", servicePrefix: "softcom-signal-staging_postgres", enabled: true }],
  links: [{ targetId: "parent", hostKey: "ASGARD", vmKey: "qemu/1", parentHostKey: "ASGARD" }],
  vms: [{ parentHostKey: "ASGARD", vmKey: "qemu/1", linuxHostKey: "vm-worker" }],
  coverage: [],
  checkedAt: Date.now(),
};

function container(name) {
  return { hostKey: "vm-worker", name, status: "running", statusFresh: true, health: "healthy", healthFresh: true, cpu: 1, memory: 2, uptimeSeconds: 9 };
}

describe("signal service notifications", () => {
  it("keeps the same condition identity when the task name changes", async () => {
    const seen = [];
    const record = async (_target, observations) => { seen.push(observations); };
    const hosts = [{ hostKey: "vm-worker", role: "linux", disabled: false, readable: true }];
    await recordSignalServiceNotifications({ ...scope, targets: [target], hosts, containers: [container("softcom-signal-staging_postgres.1.old")] }, record);
    await recordSignalServiceNotifications({ ...scope, targets: [target], hosts, containers: [container("softcom-signal-staging_postgres.1.new")] }, record);
    for (const observations of seen) {
      assert.equal(observations.some(row => row.resourceIdentity), false);
      assert.deepEqual(observations.map(row => [row.key, row.observation.state]), [["status", "healthy"], ["health", "healthy"]]);
    }
  });

  it("suppresses every family when the linked agent is disabled", async () => {
    let families = null;
    let observations = [];
    await recordSignalServiceNotifications({
      ...scope, targets: [target], containers: [container("softcom-signal-staging_postgres.1.a")],
      hosts: [{ hostKey: "vm-worker", role: "linux", disabled: true, readable: true }],
    }, async (_target, rows, complete) => { observations = rows; families = complete; });
    assert.deepEqual(families, []);
    assert.equal(observations[0].key, "availability");
    assert.equal(observations[0].observation.state, "suppressed");
  });

  it("does not complete a baseline from an unreadable container", async () => {
    let families = null;
    await recordSignalServiceNotifications({
      ...scope, targets: [target], containers: [],
      hosts: [{ hostKey: "vm-worker", role: "linux", disabled: false, readable: true }],
    }, async (_target, _rows, complete) => { families = complete; });
    assert.deepEqual(families, []);
  });
});
