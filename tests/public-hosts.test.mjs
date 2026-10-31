import test from "node:test";
import assert from "node:assert/strict";
import { isPublicHost, normalizePublicHost, publicHosts } from "../lib/server/auth/public-hosts.ts";
import { BffError, protectedResponse, publicResponse } from "../lib/server/bff.ts";
import { withoutProbeRecipe, withoutVpsAddress, withoutVpsKey, withoutVpsPrivate, publicGet } from "../lib/server/monitoring/public-handlers.ts";

test("only anonymous GETs on allowed public hosts expose CORS, including errors", async () => {
  const previous = process.env.PULSE_PUBLIC_HOSTS;
  process.env.PULSE_PUBLIC_HOSTS = "localhost";
  try {
    const request = (headers = {}, method = "GET") => new Request("http://localhost/api/public/dashboard/overview", { method, headers: { Host: "localhost", Origin: "null", ...headers } });
    const success = await publicResponse(request(), async () => ({ ok: true }));
    assert.equal(success.headers.get("Access-Control-Allow-Origin"), "*");
    assert.equal(success.headers.get("Access-Control-Allow-Credentials"), null);
    assert.equal(success.headers.get("Cache-Control"), "no-store");
    const failure = await publicResponse(request(), async () => { throw new BffError(503, "unavailable"); });
    assert.equal(failure.status, 503);
    assert.equal(failure.headers.get("Access-Control-Allow-Origin"), "*");
    for (const [req, status] of [[request({ Host: "other.test" }), 403], [request({}, "POST"), 405]]) {
      const denied = await publicResponse(req, async () => { assert.fail("Denied action must not run"); });
      assert.equal(denied.status, status);
      assert.equal(denied.headers.get("Access-Control-Allow-Origin"), null);
    }
    const authenticated = await publicResponse(request({ Authorization: "Bearer test" }), async () => ({ ok: true }));
    assert.equal(authenticated.headers.get("Access-Control-Allow-Origin"), null);
    const privateRead = await protectedResponse(request(), async () => ({ ok: true }));
    assert.equal(privateRead.status, 401);
    assert.equal(privateRead.headers.get("Access-Control-Allow-Origin"), null);
  } finally {
    if (previous === undefined) delete process.env.PULSE_PUBLIC_HOSTS;
    else process.env.PULSE_PUBLIC_HOSTS = previous;
  }
});

test("public hosts ignore blanks, scheme, path and port", () => {
  assert.equal(normalizePublicHost(" LocalHost:3000 "), "localhost");
  assert.equal(normalizePublicHost("https://Dev-Pulse.softcomtecnologia.com/path"), "dev-pulse.softcomtecnologia.com");
  assert.deepEqual([...publicHosts(" localhost , , 127.0.0.1 , ")].sort(), ["127.0.0.1", "localhost"]);
  assert.equal(publicHosts("").size, 0);
  assert.equal(publicHosts(undefined).size, 0);
});

test("request host must be in the list", () => {
  const previous = process.env.PULSE_PUBLIC_HOSTS;
  process.env.PULSE_PUBLIC_HOSTS = "localhost,127.0.0.1";
  try {
    assert.equal(isPublicHost(new Request("http://localhost:3000/api/public/dashboard/overview", { headers: { Host: "localhost:3000" } })), true);
    assert.equal(isPublicHost(new Request("http://127.0.0.1/api/public/dashboard/overview", { headers: { Host: "127.0.0.1" } })), true);
    assert.equal(isPublicHost(new Request("http://evil.test/api/public/dashboard/overview", { headers: { Host: "evil.test" } })), false);
    assert.equal(isPublicHost(new Request("http://localhost/api/public/dashboard/overview", { headers: { Host: "evil.test", "X-Forwarded-Host": "localhost" } })), false);
  } finally {
    if (previous === undefined) delete process.env.PULSE_PUBLIC_HOSTS;
    else process.env.PULSE_PUBLIC_HOSTS = previous;
  }
});

test("empty public host list refuses every public read", async () => {
  const previous = process.env.PULSE_PUBLIC_HOSTS;
  process.env.PULSE_PUBLIC_HOSTS = "";
  try {
    const denied = await publicResponse(new Request("http://localhost/api/public/dashboard/overview", { headers: { Host: "localhost" } }), async () => ({ ok: true }));
    assert.equal(denied.status, 403);
    assert.deepEqual(await denied.json(), { error: { code: "host_not_allowed" } });
  } finally {
    if (previous === undefined) delete process.env.PULSE_PUBLIC_HOSTS;
    else process.env.PULSE_PUBLIC_HOSTS = previous;
  }
});

test("public responses omit VPS key, address and probe recipe fields", () => {
  assert.deepEqual(withoutVpsKey([{ id: "1", apiKey: "secret", name: "vps" }]), [{ id: "1", name: "vps" }]);
  assert.deepEqual(withoutVpsAddress({ id: "1", ip: "10.1.1.8", name: "vps" }), { id: "1", ip: "", name: "vps" });
  assert.deepEqual(withoutProbeRecipe([{ id: "1", bodyTemplate: "{}", headerName: "X", expectedValue: true, displayName: "app" }]), [{ id: "1", displayName: "app" }]);
  assert.deepEqual(withoutVpsPrivate({ id: "1", apiKey: "secret", name: "vps", stacks: [{ id: "s1", notes: "senha" }] }), { id: "1", name: "vps", stacks: [] });
});

test("public GET refuses hosts outside the list and unknown paths", async () => {
  const previous = process.env.PULSE_PUBLIC_HOSTS;
  process.env.PULSE_PUBLIC_HOSTS = "localhost";
  try {
    const denied = await publicGet(new Request("http://localhost/api/public/dashboard/overview", { headers: { Host: "other.test" } }), ["dashboard", "overview"]);
    assert.equal(denied.status, 403);
    assert.deepEqual(await denied.json(), { error: { code: "host_not_allowed" } });
    const missing = await publicGet(new Request("http://localhost/api/public/monitoring/standalone-vps", { headers: { Host: "localhost" } }), ["monitoring", "unknown"]);
    assert.equal(missing.status, 404);
    assert.deepEqual(await missing.json(), { error: { code: "not_found" } });
    const containers = await publicGet(new Request("http://localhost/api/public/monitoring/containers", { headers: { Host: "localhost" } }), ["monitoring", "containers"]);
    assert.equal(containers.status, 404);
    const vmWorkloads = await publicGet(new Request("http://localhost/api/public/monitoring/hosts/ASGARD/vms/vm-1/containers", { headers: { Host: "localhost" } }), ["monitoring", "hosts", "ASGARD", "vms", "vm-1", "containers"]);
    assert.equal(vmWorkloads.status, 404);
  } finally {
    if (previous === undefined) delete process.env.PULSE_PUBLIC_HOSTS;
    else process.env.PULSE_PUBLIC_HOSTS = previous;
  }
});
