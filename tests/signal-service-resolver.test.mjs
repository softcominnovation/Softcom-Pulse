import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { suggestServicePrefix, servicePrefixError, serviceCandidateKind } from "../lib/signal/service-prefix.ts";
import { resolveSignalService } from "../lib/signal/service-resolver.ts";

const host = { hostKey: "vm-squad-ia-worker-01", role: "linux", disabled: false, readable: true };
const vm = { parentHostKey: "ASGARD", vmKey: "qemu/8003001", linuxHostKey: "vm-squad-ia-worker-01" };
const link = { hostKey: "ASGARD", vmKey: "qemu/8003001", parentHostKey: "ASGARD" };
const container = (name, status = "running", extra = {}) => ({
  hostKey: "vm-squad-ia-worker-01", name, status, statusFresh: true, health: "healthy", healthFresh: true, cpu: 1, memory: 2, uptimeSeconds: 9, ...extra,
});

function resolve(overrides) {
  return resolveSignalService({
    servicePrefix: "softcom-signal-staging_postgres",
    links: [link], vms: [vm], hosts: [host], coverage: [], containers: [], ...overrides,
  });
}

describe("signal service prefix", () => {
  it("keeps the service name and drops only the task suffix", () => {
    assert.equal(suggestServicePrefix("/softcom-signal-staging_postgres.1.abc123"), "softcom-signal-staging_postgres");
    assert.equal(suggestServicePrefix("softcom-signal-staging_postgres"), "softcom-signal-staging_postgres");
    assert.equal(suggestServicePrefix("app.worker.1"), "app.worker.1");
    assert.equal(servicePrefixError("softcom-signal-staging_postgres.1.abc"), "Use o nome do serviço, sem o sufixo da task.");
    assert.equal(servicePrefixError("postgres"), null);
  });

  it("recognizes postgres and redis service names and ignores other containers", () => {
    assert.equal(serviceCandidateKind("softcom-signal-staging_postgres"), "database");
    assert.equal(serviceCandidateKind("softcom-n8n-staging_postgres"), "database");
    assert.equal(serviceCandidateKind("softcom-signal-evolution-staging_evolution-postgres"), "database");
    assert.equal(serviceCandidateKind("softcom-signal-staging_redis"), "redis");
    assert.equal(serviceCandidateKind("softcom-signal-evolution-staging_evolution-redis"), "redis");
    assert.equal(serviceCandidateKind("codex-signal-local-redis-proxy"), "redis");
    assert.equal(serviceCandidateKind("buildx_buildkit_signal-release-gate0"), null);
  });
});

describe("signal service resolver", () => {
  it("follows three task suffixes as the same service", () => {
    for (const suffix of ["aaa", "bbb", "ccc"]) {
      const result = resolve({ containers: [container(`softcom-signal-staging_postgres.1.${suffix}`)] });
      assert.equal(result.resolution, "selected");
      assert.equal(result.kpiLabel, "No ar");
      assert.equal(result.candidate.name.endsWith(suffix), true);
    }
  });

  it("does not match a shorter prefix inside the service name", () => {
    const result = resolve({ servicePrefix: "postgres", containers: [container("softcom-signal-staging_postgres.1.abc")] });
    assert.equal(result.resolution, "unknown");
    assert.equal(result.reason, "coverage_unavailable");
  });

  it("prefers the running task over a stopped one", () => {
    const result = resolve({ containers: [
      container("softcom-signal-staging_postgres.1.old", "stopped", { health: "unknown", healthFresh: false }),
      container("softcom-signal-staging_postgres.1.new", "running"),
    ] });
    assert.equal(result.candidate.name.endsWith("new"), true);
    assert.equal(result.kpiLabel, "No ar");
  });

  it("stays ambiguous when two tasks are running", () => {
    const result = resolve({ containers: [
      container("softcom-signal-staging_postgres.1.a", "running"),
      container("softcom-signal-staging_postgres.1.b", "running"),
    ] });
    assert.equal(result.resolution, "ambiguous");
    assert.equal(result.kpiLabel, "Sem leitura");
  });

  it("does not choose a running task while another status is uncertain", () => {
    const result = resolve({ containers: [
      container("softcom-signal-staging_postgres.1.a", "running"),
      container("softcom-signal-staging_postgres.1.b", "paused", { statusFresh: false }),
    ] });
    assert.equal(result.resolution, "unknown");
  });

  it("reports down only when coverage lists no remaining name", () => {
    const missing = resolve({ containers: [] });
    assert.equal(missing.reason, "coverage_unavailable");
    const gone = resolve({ containers: [], coverage: [{ hostKey: host.hostKey, complete: true, fresh: true, names: ["other.1.a"] }] });
    assert.equal(gone.resolution, "down");
    assert.equal(gone.kpiLabel, "Fora");
  });

  it("does not treat an old stopped task as current when enumeration has a new name", () => {
    const result = resolve({
      containers: [container("softcom-signal-staging_postgres.1.old", "stopped")],
      coverage: [{ hostKey: host.hostKey, complete: true, fresh: true, names: ["softcom-signal-staging_postgres.1.old", "softcom-signal-staging_postgres.1.new"] }],
    });
    assert.equal(result.reason, "enumeration_pending");
  });

  it("ignores the same prefix on a VM that is not linked", () => {
    const result = resolve({ containers: [container("softcom-signal-staging_postgres.1.a", "running", { hostKey: "vm-other" })] });
    assert.equal(result.resolution, "unknown");
  });

  it("searches a newly linked agent without changing the prefix", () => {
    const result = resolve({
      links: [{ hostKey: "ASGARD", vmKey: "qemu/2", parentHostKey: "ASGARD" }],
      vms: [{ parentHostKey: "ASGARD", vmKey: "qemu/2", linuxHostKey: "vm-new" }],
      hosts: [{ hostKey: "vm-new", role: "linux", disabled: false, readable: true }],
      containers: [container("softcom-signal-staging_postgres.1.a", "running", { hostKey: "vm-new" })],
    });
    assert.equal(result.hostKeys[0], "vm-new");
    assert.equal(result.kpiLabel, "No ar");
  });

  it("maps health and status onto the kpi labels", () => {
    assert.equal(resolve({ containers: [container("softcom-signal-staging_postgres.1.a", "running", { health: "not_configured" })] }).kpiLabel, "No ar");
    assert.equal(resolve({ containers: [container("softcom-signal-staging_postgres.1.a", "running", { health: "starting" })] }).kpiLabel, "Atualizando");
    assert.equal(resolve({ containers: [container("softcom-signal-staging_postgres.1.a", "restarting")] }).kpiLabel, "Atualizando");
    assert.equal(resolve({ containers: [container("softcom-signal-staging_postgres.1.a", "paused")] }).kpiLabel, "Atenção");
    assert.equal(resolve({ containers: [container("softcom-signal-staging_postgres.1.a", "running", { health: "unhealthy" })] }).kpiLabel, "Fora");
    assert.equal(resolve({ containers: [container("softcom-signal-staging_postgres.1.a", "dead", { health: "unknown", healthFresh: false })] }).kpiLabel, "Fora");
  });

  it("keeps a running service up when the health sample is stale", () => {
    const result = resolve({ containers: [container("softcom-signal-staging_postgres.1.a", "running", { healthFresh: false, health: "unhealthy" })] });
    assert.equal(result.kpiLabel, "No ar");
    assert.equal(result.statusState, "healthy");
    assert.equal(result.healthState, "unknown");
    assert.equal(result.healthNote, null);
  });

  it("names a running process without a healthcheck", () => {
    const result = resolve({ containers: [container("softcom-signal-staging_postgres.1.a", "running", { health: "not_configured" })] });
    assert.equal(result.healthNote, "Processo no ar, sem healthcheck.");
    assert.equal(result.healthState, "unknown");
  });

  it("reports every fresh stopped task as down and ignores a stale running status", () => {
    const stopped = resolve({ containers: [
      container("softcom-signal-staging_postgres.1.old", "stopped"),
      container("softcom-signal-staging_postgres.1.older", "dead"),
    ] });
    assert.equal(stopped.resolution, "down");
    const stale = resolve({ containers: [container("softcom-signal-staging_postgres.1.a", "running", { statusFresh: false })] });
    assert.equal(stale.resolution, "unknown");
    assert.notEqual(stale.reason, "down");
  });

  it("does not call an empty link set a down service", () => {
    assert.equal(resolve({ links: [] }).reason, "no_scope");
    assert.equal(resolve({ hosts: [{ ...host, readable: false }] }).reason, "incomplete_scope");
    assert.equal(resolve({ hosts: [{ ...host, disabled: true }] }).resolution, "suppressed");
  });
});
