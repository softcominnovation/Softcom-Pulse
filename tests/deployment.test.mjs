import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import YAML from "yaml";
const read = path => readFileSync(new URL("../" + path, import.meta.url), "utf8");

for (const dev of [false, true]) {
  test((dev ? "dev" : "prod") + " stack isolates names, routing and storage", () => {
    const c = YAML.parse(read("docker/docker-compose" + (dev ? ".dev" : "") + ".yaml"));
    const web = dev ? "pulse-dev" : "pulse", db = dev ? "pulse_postgres_dev" : "pulse_postgres", cache = dev ? "pulse_redis_dev" : "pulse_redis";
    assert.equal(c.version, "3.8");
    assert.deepEqual(c.networks, { network_public: { external: true, name: "network_public" } });
    assert.deepEqual(Object.keys(c.services), [web, web + "-collector", web + "-probe", web + "-vps-monitor", web + "-signal-monitor", db, cache]);
    for (const [name, service] of Object.entries(c.services)) {
      assert.deepEqual(service.networks, ["network_public"]);
      assert.equal(service.ports, undefined);
      assert.equal(service.depends_on, undefined);
      assert.equal(service.deploy.replicas, 1);
      assert.deepEqual(service.deploy.placement.constraints, ["node.role == manager"]);
      assert.ok(service.deploy.resources.limits.memory);
      assert.ok(service.deploy.resources.reservations.memory);
      if (name !== web) assert.equal(service.deploy.labels, undefined);
    }
    const app = c.services[web];
    const image = "ghcr.io/softcominnovation/softcom-pulse:${PULSE_VERSION:-" + (dev ? "dev" : "latest") + "}";
    assert.equal(app.image, image);
    for (const suffix of ["-collector", "-probe", "-vps-monitor", "-signal-monitor"]) assert.equal(c.services[web + suffix].image, image);
    assert.equal(app.environment.API_BASE_URL, "${API_BASE_URL:-https://api.softcom.cloud}");
    assert.equal(app.environment.PULSE_EDITOR_EMAILS, "${PULSE_EDITOR_EMAILS:-}");
    assert.equal(app.environment.PULSE_PUBLIC_HOSTS, "${PULSE_PUBLIC_HOSTS:-}");
    assert.equal(c.services[web + "-collector"].environment.API_BASE_URL, "${API_BASE_URL:-https://api.softcom.cloud}");
    assert.equal(c.services[web + "-collector"].environment.PULSE_EDITOR_EMAILS, undefined);
    assert.equal(c.services[web + "-collector"].environment.PULSE_PUBLIC_HOSTS, undefined);
    assert.equal(c.services[web + "-probe"].environment.PULSE_EDITOR_EMAILS, undefined);
    assert.equal(c.services[web + "-probe"].environment.PULSE_PUBLIC_HOSTS, undefined);
    assert.equal(c.services[web + "-vps-monitor"].environment.PULSE_EDITOR_EMAILS, undefined);
    assert.equal(c.services[web + "-vps-monitor"].environment.PULSE_PUBLIC_HOSTS, undefined);
    assert.equal(c.services[web + "-signal-monitor"].environment.PULSE_EDITOR_EMAILS, undefined);
    assert.equal(c.services[web + "-signal-monitor"].environment.PULSE_PUBLIC_HOSTS, undefined);
    assert.ok(app.environment.REDIS_URL.includes(cache));
    assert.equal(c.services[web + "-collector"].deploy.update_config.order, "stop-first");
    assert.deepEqual(c.services[web + "-collector"].command, ["node", "--conditions=react-server", "collector/index.mjs"]);
    const probe = c.services[web + "-probe"];
    assert.deepEqual(probe.command, ["node", "--conditions=react-server", "collector/probe.mjs"]);
    assert.equal(probe.environment.PROBE_INTERVAL_MS, "${PROBE_INTERVAL_MS:-60000}");
    assert.equal(probe.environment.ZABBIX_API_URL, undefined);
    assert.equal(probe.environment.ZABBIX_API_TOKEN, undefined);
    assert.equal(probe.deploy.labels, undefined);
    const vps = c.services[web + "-vps-monitor"];
    assert.deepEqual(vps.command, ["node", "--conditions=react-server", "collector/vps-monitor.mjs"]);
    assert.equal(vps.environment.VPS_MONITOR_INTERVAL_MS, "${VPS_MONITOR_INTERVAL_MS:-60000}");
    assert.equal(vps.environment.ZABBIX_API_URL, undefined);
    assert.equal(vps.environment.ZABBIX_API_TOKEN, undefined);
    assert.equal(vps.deploy.labels, undefined);
    const signal = c.services[web + "-signal-monitor"];
    assert.deepEqual(signal.command, ["node", "--conditions=react-server", "collector/signal-monitor.mjs"]);
    assert.equal(signal.environment.SIGNAL_MONITOR_INTERVAL_MS, "${SIGNAL_MONITOR_INTERVAL_MS:-60000}");
    assert.equal(signal.environment.SIGNAL_API_BASE_URL, "${SIGNAL_API_BASE_URL:-}");
    assert.equal(signal.environment.SIGNAL_HEALTH_LIVE_PATH, "${SIGNAL_HEALTH_LIVE_PATH:-/health/live}");
    assert.equal(signal.environment.SIGNAL_HEALTH_READY_PATH, "${SIGNAL_HEALTH_READY_PATH:-/health/ready}");
    assert.equal(signal.environment.ZABBIX_API_URL, undefined);
    assert.equal(signal.environment.ZABBIX_API_TOKEN, undefined);
    assert.equal(signal.deploy.labels, undefined);
    assert.deepEqual(c.services[cache].command, ["redis-server", "--appendonly", "yes"]);
    assert.ok(c.services[db].environment.POSTGRES_PASSWORD.includes(dev ? "POSTGRES_PASSWORD_DEV:" : "POSTGRES_PASSWORD:"));
    assert.ok(app.deploy.labels.includes("traefik.http.routers." + web + ".tls.certresolver=letsencryptresolver"));
    assert.ok(app.deploy.labels.includes("traefik.http.routers." + web + ".entrypoints=websecure"));
    assert.ok(app.deploy.labels.some(label => label.includes("Host(`" + (dev ? "dev-" : "") + "pulse.softcomtecnologia.com`)")));
    assert.deepEqual(Object.keys(c.volumes), [db + "_data", cache + "_data"]);
  });
  test((dev ? "dev" : "prod") + " workflow only publishes from the correct tags", () => {
    const c = YAML.parse(read(".github/workflows/deploy-" + (dev ? "dev" : "prod") + ".yml"));
    assert.deepEqual(Object.keys(c.on), ["push"]);
    assert.deepEqual(Object.keys(c.on.push), ["tags"]);
    assert.deepEqual(c.on.push.tags, dev ? ["v*.*.*-dev"] : ["v*.*.*", "!*-*", "!*\\+*"]);
    assert.deepEqual(c.permissions, { contents: "read", packages: "write" });
    assert.equal(c.jobs.publish.uses, "./.github/workflows/release.yml");
    assert.equal(c.jobs.publish.with.environment, dev ? "development" : "production");
    assert.equal(c.concurrency["cancel-in-progress"], false);
  });
}
test("entrypoint and build context preserve the runtime boundary", () => {
  const dockerfile = read("Dockerfile"), entrypoint = read("docker/entrypoint.sh");
  assert.ok(!entrypoint.includes("\r"));
  assert.match(entrypoint, /set -eu/);
  assert.ok(entrypoint.indexOf("node docker/migrate.mjs") < entrypoint.indexOf('exec "$@"'));
  assert.match(dockerfile, /USER node/);
  assert.match(dockerfile, /chmod 755 docker\/entrypoint.sh/);
  assert.doesNotMatch(dockerfile, /AS runtime-dependencies|COPY --from=runtime-dependencies/);
  assert.match(dockerfile, /COPY --from=runtime-source --chown=node:node \/app\/\.next\/standalone/);
  assert.match(dockerfile, /ARG RUNTIME_SOURCE=builder/);
  assert.match(dockerfile, /target=\/app\/\.next\/cache/);
  assert.match(dockerfile, /ARG TARGETARCH/);
  assert.ok(dockerfile.includes("id=pulse-next-${TARGETARCH},sharing=locked"));
  for (const part of [".env*", ".git", "node_modules", ".next", "docs"]) assert.ok(read(".dockerignore").split(/\r?\n/).includes(part));
});

test("parallel validation gates native images and version aliases without omitting any suite", () => {
  const c = YAML.parse(read(".github/workflows/release.yml"));
  assert.deepEqual(Object.keys(c.on), ["workflow_call"]);
  assert.equal(c.jobs.runtime.needs, "release");
  assert.equal(c.jobs.interface.needs, "release");
  assert.deepEqual(c.jobs.images.needs, ["runtime", "interface"]);
  assert.deepEqual(c.jobs.publish.needs, ["release", "images"]);
  for (const job of [c.jobs.runtime, c.jobs.images]) {
    assert.deepEqual(job.strategy.matrix.include, [{ arch: "amd64", runner: "ubuntu-24.04" }, { arch: "arm64", runner: "ubuntu-24.04-arm" }]);
    assert.equal(job.strategy["fail-fast"], false);
    assert.equal(job["runs-on"], "${{ matrix.runner }}");
  }
  const runtime = c.jobs.runtime.steps.map(step => step.run ?? "").join("\n");
  for (const command of ["npm run check", "npm run test:integration", "npm run test:runtime", "tests/runtime/package.test.mjs", "verify-runtime.mjs"]) assert.ok(runtime.includes(command));
  assert.ok(c.jobs.runtime.steps.some(step => step.with?.path === ".next/cache"));
  const ui = c.jobs.interface.steps.map(step => step.run ?? "").join("\n");
  for (const command of ["npm run db:generate", "test:components", "test:ui -- --shard=1/2", "test:ui -- --shard=2/2"]) assert.ok(ui.includes(command));
  assert.deepEqual(c.jobs.interface.strategy.matrix.suite, ["components", "ui-1", "ui-2"]);
  for (const job of [c.jobs.interface, c.jobs.runtime]) assert.ok(job.services.postgres && job.services.redis);
  const steps = c.jobs.images.steps;
  const smoke = steps.findIndex(step => step.run?.includes("--non-root"));
  const push = steps.findIndex(step => step.with?.outputs?.includes("push-by-digest=true"));
  assert.ok(smoke >= 0 && push > smoke);
  assert.ok(!steps[smoke].run.includes("--entrypoint"), "Smoke must execute the migration entrypoint");
  assert.equal(steps[push].with["build-args"], "RUNTIME_SOURCE=prebuilt");
  assert.ok(!read(".github/workflows/release.yml").includes("setup-qemu"));
  assert.ok(c.jobs.publish.steps.some(step => step.run?.includes("publish-manifest.mjs")));
});
