import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { probeIntervalMs, serviceIssues } from "../lib/config/external-services.ts";
import { isBlockedAddress, parseProbeUrl } from "../lib/server/probe/network.ts";
import { classifyProbe, pointerValue } from "../lib/server/probe/classify.ts";
import { openProbeSecret, sealProbeSecret } from "../lib/server/probe/secret.ts";

test("probe interval is 60s unless a value from 30s to 120s is set", () => {
  assert.equal(probeIntervalMs(undefined), 60000);
  assert.equal(probeIntervalMs(""), 60000);
  assert.equal(probeIntervalMs("30000"), 30000);
  assert.equal(probeIntervalMs("120000"), 120000);
  for (const value of ["29999", "120001", "60000.5", "60s", "0"]) assert.equal(probeIntervalMs(value), null, value);
});

test("probe URLs reject query, userinfo, localhost, loopback and metadata before any request", () => {
  assert.equal(parseProbeUrl("https://1.1.1.1/health").hostname, "1.1.1.1");
  assert.equal(parseProbeUrl("https://10.1.1.8/health").hostname, "10.1.1.8");
  for (const url of ["http://1.1.1.1/health", "https://user:secret@1.1.1.1/health", "https://1.1.1.1/health?token=secret", "https://1.1.1.1/health#secret", "https://localhost/health", "https://127.0.0.1/health", "https://169.254.169.254/latest", "https://[::1]/health"]) {
    assert.throws(() => parseProbeUrl(url), error => error.status === 400 && error.code === "invalid_request", url);
  }
  assert.equal(isBlockedAddress("example.com"), false);
  assert.equal(isBlockedAddress("8.8.8.8"), false);
  assert.equal(isBlockedAddress("10.0.0.8"), false);
  for (const address of ["127.0.0.1", "::1", "0.0.0.0", "::", "169.254.169.254", "::ffff:127.0.0.1", "224.0.0.1", "fe80::1"]) assert.equal(isBlockedAddress(address), true, address);
});

test("probe classification keeps the closed reason table", () => {
  const ok = { status: 200, body: "", latencyMs: 100 };
  assert.equal(classifyProbe("http_status", [200], null, null, ok).reason, 0);
  assert.equal(classifyProbe("http_status", [200], null, null, { ...ok, latencyMs: 2501 }).reason, 1);
  assert.equal(classifyProbe("http_status", [200], null, null, { ...ok, latencyMs: 8000 }, 20000).reason, 0);
  assert.equal(classifyProbe("http_status", [200], null, null, { ...ok, latencyMs: 12000 }, 20000).reason, 1);
  assert.equal(classifyProbe("http_status", [200], null, null, { status: 401, body: "secret", latencyMs: 20 }).reason, 2);
  assert.equal(classifyProbe("http_status", [200], null, null, { status: 302, body: "", latencyMs: 20 }).reason, 3);
  assert.equal(classifyProbe("json_match", [200], "/status", JSON.stringify("up"), { status: 200, body: JSON.stringify({ status: "up" }), latencyMs: 20 }).reason, 0);
  assert.equal(classifyProbe("json_match", [200], "/status", JSON.stringify("up"), { status: 200, body: "{}", latencyMs: 20 }).reason, 4);
  assert.deepEqual(classifyProbe("http_status", [200], null, null, { error: "timeout" }), { reason: 5, latencyMs: null, httpStatus: null });
  assert.equal(classifyProbe("http_status", [200], null, null, { error: "network" }).reason, 6);
  assert.equal(classifyProbe("http_status", [200], null, null, { error: "tls" }).reason, 7);
  assert.equal(pointerValue({ "a/b": ["x"] }, "/a~1b/0"), "x");
  assert.equal(pointerValue(["x"], "/01"), undefined);
});

test("probe contract rejects head json matching and a secret that is not required", () => {
  const base = { displayName: "API", description: null, serviceType: null, enabled: true, dashboardEnabled: false, critical: false, displayOrder: 0, method: "HEAD", url: "https://1.1.1.1/health", successMode: "json_match", expectedStatuses: [200], jsonPointer: "/ok", expectedValue: true, bodyTemplate: null, authMode: "none", headerName: null, secret: undefined };
  assert.ok(serviceIssues(base, false).includes("successMode"));
  assert.ok(serviceIssues({ ...base, method: "GET", successMode: "http_status", jsonPointer: null, expectedValue: null, secret: "unused" }, false).includes("secret"));
  assert.deepEqual(serviceIssues({ ...base, method: "GET", successMode: "http_status", jsonPointer: null, expectedValue: null }, false), []);
});

test("probe secret round-trips with its own key and never stores the plaintext", () => {
  const previous = process.env.TOKEN_ENCRYPTION_KEY;
  process.env.TOKEN_ENCRYPTION_KEY = randomBytes(32).toString("base64");
  try {
    const sealed = sealProbeSecret("top-secret");
    assert.equal(sealed.includes("top-secret"), false);
    assert.equal(openProbeSecret(sealed), "top-secret");
    assert.throws(() => openProbeSecret(sealed.slice(0, -4) + "aaaa"), error => error.code === "probe_secret_unavailable");
  } finally {
    if (previous === undefined) delete process.env.TOKEN_ENCRYPTION_KEY;
    else process.env.TOKEN_ENCRYPTION_KEY = previous;
  }
});
