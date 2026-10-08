import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { login, refresh, logout, session, requireSession } from "../lib/server/auth/index.ts";
import { issueSession } from "../lib/server/auth/corporate.ts";
import { openEnvelope, sealEnvelope } from "../lib/server/auth/envelope.ts";

process.env.TOKEN_ENCRYPTION_KEY = randomBytes(32).toString("base64");
process.env.API_BASE_URL = "https://auth.example.test";
const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });
const user = { id: 42, nome: "Colaborador", email: "test@example.test", administrador: false, empresa: "JP", solicitante: 0, permissoes: ["existing"], acessos: [] };
const tokens = patch => ({ accessToken: "private-access", refreshToken: "private-refresh", tokenType: "Bearer", expiresIn: 7200, user, ...patch });
const post = (path, body) => new Request("http://localhost/api/auth/" + path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
const bearer = token => new Request("http://localhost/api/auth/session", { headers: { Authorization: "Bearer " + token } });

test("login trims email, forwards only credentials, and seals both tokens", async () => {
  globalThis.fetch = async (url, options) => {
    assert.equal(url, "https://auth.example.test/v1/auth/login");
    assert.deepEqual(options.headers, { "Content-Type": "application/json" });
    assert.deepEqual(JSON.parse(options.body), { email: "test@example.test", senha: "password" });
    assert.equal(options.cache, "no-store");
    return Response.json(tokens());
  };
  const response = await login(post("login", { email: " test@example.test ", senha: "password", user: { id: 900 }, expiresAt: 99999999999999 }));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  const data = await response.json();
  assert.equal(JSON.stringify(data).includes("private-access"), false);
  assert.equal(JSON.stringify(data).includes("private-refresh"), false);
  assert.equal(openEnvelope(data.accessToken, "access").token, "private-access");
  assert.equal(openEnvelope(data.refreshToken, "refresh").token, "private-refresh");
  assert.deepEqual(data.user, user);
  const previousEditors = process.env.PULSE_EDITOR_EMAILS;
  process.env.PULSE_EDITOR_EMAILS = "";
  const validation = await session(bearer(data.accessToken));
  process.env.PULSE_EDITOR_EMAILS = previousEditors;
  assert.equal(validation.status, 200);
  assert.deepEqual(await validation.json(), { user, expiresAt: data.expiresAt, editor: false });
});
test("invalid form never calls upstream and errors never echo upstream secrets", async () => {
  globalThis.fetch = () => { throw new Error("must not call"); };
  assert.equal((await login(post("login", { email: "bad", senha: "" }))).status, 400);
  for (const [upstream, expected] of [[401,401],[403,401],[429,429],[500,502]]) {
    globalThis.fetch = async () => Response.json({ password: "secret", accessToken: "raw" }, { status: upstream });
    const result = await login(post("login", { email: "test@example.test", senha: "password" }));
    assert.equal(result.status, expected);
    assert.doesNotMatch(await result.text(), /secret|raw/);
  }
  globalThis.fetch = async () => { throw new Error("private network details"); };
  assert.equal((await login(post("login", { email: "test@example.test", senha: "password" }))).status, 503);
});
test("direct BFF calls reject tampering, expiration and swapped token types", async () => {
  const valid = issueSession(tokens());
  const pieces = valid.accessToken.split(".");
  pieces[2] = (pieces[2][0] === "a" ? "b" : "a") + pieces[2].slice(1);
  const expired = sealEnvelope({ type: "access", token: "raw", user, sessionId: randomUUID(), expiresAt: Date.now() - 1 });
  for (const value of [pieces.join("."), expired, valid.refreshToken, "raw", "v1.invalid"]) {
    const result = await session(bearer(value));
    assert.equal(result.status, 401);
    assert.equal(result.headers.get("cache-control"), "no-store");
  }
  assert.equal((await session(new Request("http://localhost/api/auth/session"))).status, 401);
  assert.equal((await refresh(post("refresh", { refreshToken: valid.accessToken }))).status, 401);
  assert.equal((await logout(post("logout", { refreshToken: valid.accessToken }))).status, 401);
  assert.throws(() => requireSession(bearer(expired)));
});
test("nonce uniqueness, strict key length and authenticated purpose", () => {
  const a = issueSession(tokens()), b = issueSession(tokens());
  assert.notEqual(a.accessToken, b.accessToken);
  const key = process.env.TOKEN_ENCRYPTION_KEY;
  try { process.env.TOKEN_ENCRYPTION_KEY = "passphrase"; assert.throws(() => issueSession(tokens())); }
  finally { process.env.TOKEN_ENCRYPTION_KEY = key; }
});
test("expiry uses valid TTL, fallback and trusted JWT cap", () => {
  const now = Date.now();
  for (const expiresIn of [undefined, 0, -1, "7200", Infinity, NaN]) assert.equal(issueSession(tokens({ expiresIn }), undefined, now).expiresAt, now + 7200000);
  const exp = Math.floor(now / 1000) + 90;
  const accessToken = "header." + Buffer.from(JSON.stringify({ exp })).toString("base64url") + ".signature";
  assert.equal(issueSession(tokens({ accessToken }), undefined, now).expiresAt, exp * 1000);
  assert.equal(issueSession(tokens({ expiresIn: 60 }), undefined, now).expiresAt, now + 60000);
});
test("thin refresh preserves absent values but accepts explicit null, false and empty arrays", async () => {
  const previous = issueSession(tokens());
  for (const patch of [undefined, { nome: null }, { permissoes: null }, { permissoes: [] }, { acessos: null, administrador: false }]) {
    globalThis.fetch = async (url, options) => {
      assert.equal(url, "https://auth.example.test/v1/auth/refresh");
      assert.deepEqual(options.headers, { "Content-Type": "application/json" });
      assert.deepEqual(JSON.parse(options.body), { refreshToken: "private-refresh" });
      return Response.json(tokens({ accessToken: "new-access", refreshToken: "new-refresh", user: patch }));
    };
    const response = await refresh(post("refresh", { refreshToken: previous.refreshToken, user: { id: 999 } }));
    assert.equal(response.status, 200);
    const next = await response.json();
    assert.deepEqual(next.user, { ...user, ...patch });
    assert.equal(openEnvelope(next.refreshToken, "refresh").token, "new-refresh");
  }
});
test("upstream cannot accidentally switch identity during refresh or omit initial identity", () => {
  const previous = openEnvelope(issueSession(tokens()).refreshToken, "refresh");
  assert.throws(() => issueSession(tokens({ user: { id: 99 } }), previous));
  assert.throws(() => issueSession(tokens({ user: undefined })));
});
test("logout confirms revocation only on upstream success", async () => {
  const value = issueSession(tokens()).refreshToken;
  globalThis.fetch = async (url, options) => {
    assert.equal(url, "https://auth.example.test/v1/auth/logout");
    assert.deepEqual(options.headers, { "Content-Type": "application/json" });
    assert.deepEqual(JSON.parse(options.body), { refreshToken: "private-refresh" });
    return new Response(null, { status: 204 });
  };
  assert.deepEqual(await (await logout(post("logout", { refreshToken: value }))).json(), { revoked: true });
  globalThis.fetch = async () => new Response(null, { status: 503 });
  const failed = await logout(post("logout", { refreshToken: value }));
  assert.equal(failed.status, 502);
  assert.equal((await failed.json()).revoked, undefined);
});
