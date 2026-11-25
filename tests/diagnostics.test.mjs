import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { logRequestFailure, diagnosticPath } from "../lib/server/diagnostics.ts";
import { publicResponse, BffError } from "../lib/server/bff.ts";
import { authFailure, AuthError } from "../lib/server/auth/errors.ts";

const originalError = console.error;
const originalHosts = process.env.PULSE_PUBLIC_HOSTS;
afterEach(() => {
  console.error = originalError;
  if (originalHosts === undefined) delete process.env.PULSE_PUBLIC_HOSTS;
  else process.env.PULSE_PUBLIC_HOSTS = originalHosts;
});
const secret = "private-canary-do-not-log";

test("structured diagnostics retain safe causes and correlation without secrets", () => {
  const lines = []; console.error = line => lines.push(JSON.parse(line));
  const requestId = randomUUID();
  const request = new Request("http://localhost/api/settings/presentation?key=" + secret, {
    headers: { Authorization: "Bearer " + secret, Cookie: "secret=" + secret, "x-request-id": requestId },
  });
  const cause = Object.assign(new Error("postgres://user:" + secret + "@host/db"), { code: "ECONNREFUSED" });
  const error = new BffError(503, "database_unavailable", cause);
  const id = logRequestFailure({ request, status: 503, code: error.code, error });
  assert.equal(id, requestId);
  assert.equal(lines.length, 1);
  assert.equal(lines[0].path, "/api/settings/presentation");
  assert.equal(lines[0].authorizationBytes, Buffer.byteLength("Bearer " + secret));
  assert.equal(lines[0].error.cause.code, "ECONNREFUSED");
  assert.ok(lines[0].error.frames.length > 0);
  assert.ok(!JSON.stringify(lines).includes(secret));
  logRequestFailure({ request, status: 503, code: error.code, error });
  assert.equal(lines.length, 1, "Polling repeats must not flood container logs");
  assert.equal(diagnosticPath("/api/" + randomUUID() + "/" + "a".repeat(150) + "?token=" + secret), "/api/:id/:value");
});

test("handled API and auth errors log internal diagnostics without changing their public bodies", async () => {
  const lines = []; console.error = line => lines.push(JSON.parse(line));
  process.env.PULSE_PUBLIC_HOSTS = "localhost";
  const request = new Request("http://localhost/api/public/monitoring/notifications?after=" + secret, { headers: { Host: "localhost" } });
  const response = await publicResponse(request, async () => { throw new BffError(503, "notifications_unavailable", Object.assign(new Error(secret), { code: "42P01" })); });
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { error: { code: "notifications_unavailable" } });
  assert.equal(response.headers.get("x-request-id"), lines[0].requestId);
  const auth = authFailure(new AuthError(502, "auth_unavailable", { reason: "upstream_http_error", upstreamStatus: 503 }), request);
  assert.equal(auth.status, 502);
  assert.equal(lines[1].error.upstreamStatus, 503);
  assert.equal(lines[1].error.reason, "upstream_http_error");
  assert.ok(!JSON.stringify(lines).includes(secret));
});

test("a failed log sink never changes the API error response", async () => {
  console.error = () => { throw new Error("stderr unavailable"); };
  const response = authFailure(new AuthError(503, "auth_unavailable", { reason: "diagnostic_sink_test" }), new Request("http://localhost/api/auth/session"));
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { error: { code: "auth_unavailable" } });
});
