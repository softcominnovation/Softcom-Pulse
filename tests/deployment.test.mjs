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
    assert.deepEqual(Object.keys(c.services), [web, web + "-collector", db, cache]);
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
    assert.match(app.image, dev ? /:dev$/ : /:latest$/);
    assert.equal(app.environment.CORPORATE_API_URL, "https://api.softcom.cloud");
    assert.ok(app.environment.REDIS_URL.includes(cache));
    assert.equal(c.services[web + "-collector"].deploy.update_config.order, "stop-first");
    assert.deepEqual(c.services[cache].command, ["redis-server", "--appendonly", "yes"]);
    assert.ok(c.services[db].environment.POSTGRES_PASSWORD.includes(dev ? "POSTGRES_PASSWORD_DEV:" : "POSTGRES_PASSWORD:"));
    assert.ok(app.deploy.labels.includes("traefik.http.routers." + web + ".tls.certresolver=letsencryptresolver"));
    assert.ok(app.deploy.labels.includes("traefik.http.routers." + web + ".entrypoints=websecure"));
    assert.ok(app.deploy.labels.some(label => label.includes("Host(`" + (dev ? "dev-" : "") + "pulse.hostsoftcom.cloud`)")));
    assert.deepEqual(Object.keys(c.volumes), [db + "_data", cache + "_data"]);
  });
  test((dev ? "dev" : "prod") + " workflow only publishes from the correct tags", () => {
    const c = YAML.parse(read(".github/workflows/deploy-" + (dev ? "dev" : "prod") + ".yml"));
    assert.deepEqual(Object.keys(c.on), ["push"]);
    assert.deepEqual(Object.keys(c.on.push), ["tags"]);
    assert.deepEqual(c.on.push.tags, dev ? ["v*.*.*-dev"] : ["v*.*.*", "!*-*", "!*\\+*"]);
    assert.deepEqual(c.permissions, { contents: "read", packages: "write" });
    const steps = c.jobs.publish.steps;
    assert.ok(steps.find(step => step.run?.includes("validate-release.mjs " + (dev ? "development" : "production"))));
    const build = steps.find(step => step.uses?.startsWith("docker/build-push-action@"));
    assert.equal(build.with.platforms, "linux/amd64,linux/arm64");
    assert.equal(build.with.push, true);
    assert.equal(build.with["build-args"], undefined);
    const tags = steps.find(step => step.uses?.startsWith("docker/metadata-action@")).with.tags;
    assert.equal(tags.includes("value=latest"), !dev);
    assert.equal(tags.includes("value=dev\n"), dev);
  });
}
test("entrypoint and build context preserve the runtime boundary", () => {
  const dockerfile = read("Dockerfile"), entrypoint = read("docker/entrypoint.sh");
  assert.ok(!entrypoint.includes("\r"));
  assert.match(entrypoint, /set -eu/);
  assert.ok(entrypoint.indexOf("node docker/migrate.mjs") < entrypoint.indexOf('exec "$@"'));
  assert.match(dockerfile, /USER node/);
  assert.match(dockerfile, /--chmod=755/);
  for (const part of ["runtime-dependencies", "/app/prisma", "/app/collector", "/app/node_modules"]) assert.ok(dockerfile.includes(part));
  for (const part of [".env*", ".git", "node_modules", ".next", "docs"]) assert.ok(read(".dockerignore").split(/\r?\n/).includes(part));
});
