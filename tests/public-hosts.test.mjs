import test from "node:test";
import assert from "node:assert/strict";
import { isPublicHost, normalizePublicHost, publicHosts } from "../lib/server/auth/public-hosts.ts";
import { publicResponse } from "../lib/server/bff.ts";
import { withoutProbeRecipe, withoutVpsKey, withoutVpsPrivate, publicGet } from "../lib/server/monitoring/public-handlers.ts";

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

test("public responses omit VPS key and probe recipe fields", () => {
  assert.deepEqual(withoutVpsKey([{ id: "1", apiKey: "secret", name: "vps" }]), [{ id: "1", name: "vps" }]);
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
  } finally {
    if (previous === undefined) delete process.env.PULSE_PUBLIC_HOSTS;
    else process.env.PULSE_PUBLIC_HOSTS = previous;
  }
});
