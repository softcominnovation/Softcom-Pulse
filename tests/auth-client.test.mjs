import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import axios, { AxiosError } from "axios";
import { AuthController } from "../lib/client/auth-session.ts";
import { installAuthInterceptors } from "../lib/client/auth-interceptors.ts";

const user = { id: 42, nome: "Test", permissoes: [], administrador: false };
const session = (n = 0) => ({ accessToken: "v1.access." + n, refreshToken: "v1.refresh." + n, tokenType: "Bearer", expiresAt: Date.now() + 3600000, user });
const rejected = status => Object.assign(new Error("upstream"), { response: { status } });
function fixture(options = {}) {
  let raw = null, queue = Promise.resolve(), writes = Promise.resolve(), rotations = 0, resets = 0;
  const transport = {
    login: async () => session(),
    refresh: async () => { await delay(10); return session(++rotations); },
    session: async () => ({ user, expiresAt: Date.now() + 3600000 }),
    logout: async () => ({ revoked: true }),
    ...options.transport,
  };
  const deps = {
    read: () => raw, write: value => { raw = value; }, id: randomUUID, reset: () => { resets++; },
    lock: run => { const p = queue.then(run); queue = p.catch(() => {}); return p; }, ...options, transport,
    transaction: run => { const p = writes.then(run); writes = p.catch(() => {}); return p; },
  };
  return { deps, transport, create: () => new AuthController(deps), raw: () => raw, write: value => { raw = value; }, rotations: () => rotations, resets: () => resets };
}
const credentials = { email: "test@example.test", senha: "fake" };
test("two tabs and simultaneous callers rotate exactly once and persist before returning", async () => {
  const f = fixture(), a = f.create(), b = f.create();
  await a.login(credentials); await b.initialize();
  const old = a.store.getState().session.accessToken;
  const results = await Promise.all([a.refresh(old), a.refresh(old), b.refresh(old)]);
  assert.equal(f.rotations(), 1);
  assert.ok(results.every(s => s.accessToken === "v1.access.1"));
  assert.equal(JSON.parse(f.raw()).session.refreshToken, "v1.refresh.1");
  await b.sync();
  assert.equal(b.store.getState().session.accessToken, "v1.access.1");
});
test("proactive refresh runs within thirty seconds of expiry", async () => {
  const f = fixture(), a = f.create(); await a.login(credentials);
  const value = JSON.parse(f.raw()); value.session.expiresAt = Date.now() + 29000; f.write(JSON.stringify(value));
  assert.equal(await a.getAccessToken(), "v1.access.1");
  assert.equal(f.rotations(), 1);
});
for (const status of [401, 403, 503, undefined]) test("refresh failure " + status + " preserves the correct session state", async () => {
  const f = fixture({ transport: { refresh: async () => { throw rejected(status); } } }), a = f.create();
  await a.login(credentials);
  await assert.rejects(a.refresh(a.store.getState().session.accessToken));
  assert.equal(a.store.getState().status, status === 401 || status === 403 ? "anonymous" : "unavailable");
  assert.equal(!!JSON.parse(f.raw()).session, status !== 401 && status !== 403);
});
test("late refresh after logout cannot resurrect either tab", async () => {
  let finish;
  const f = fixture({ transport: { refresh: () => new Promise(resolve => { finish = resolve; }) } }), a = f.create(), b = f.create();
  await a.login(credentials); await b.initialize();
  const pending = a.refresh(a.store.getState().session.accessToken);
  await delay(0);
  const signal = a.signal;
  await b.logout(); await a.sync();
  assert.equal(signal.aborted, true);
  finish(session(7)); await assert.rejects(pending);
  assert.equal(JSON.parse(f.raw()).session, null);
  assert.equal(a.store.getState().session, null);
  assert.equal(a.store.getState().status, "anonymous");
});
test("late login or validation cannot replace a newer login", async () => {
  let finish;
  const f = fixture(), a = f.create();
  f.transport.login = () => new Promise(resolve => { finish = resolve; });
  const old = a.login(credentials);
  await delay(0);
  f.transport.login = async () => ({ ...session(2), user: { id: 99 } });
  await a.login(credentials);
  finish(session(1)); await assert.rejects(old);
  assert.equal(a.store.getState().session.user.id, 99);
  assert.equal(JSON.parse(f.raw()).session.user.id, 99);
});
test("logout is local and idempotent when the remote call fails", async () => {
  const f = fixture({ transport: { logout: async () => { throw new Error("offline"); } } }), a = f.create();
  await a.login(credentials);
  assert.deepEqual(await a.logout(), { revoked: false });
  assert.deepEqual(await a.logout(), { revoked: false });
  assert.equal(a.store.getState().session, null);
  assert.ok(f.resets() >= 3);
});
test("corrupt storage, blocked storage and missing Web Locks fail explicitly", async () => {
  const f = fixture(), a = f.create(); f.write("{broken");
  await a.initialize();
  assert.equal(a.store.getState().status, "anonymous");
  assert.match(a.store.getState().issue, /recuperada/);
  const locked = fixture({ read: () => { throw new Error("blocked"); } }).create();
  await locked.initialize();
  assert.match(locked.store.getState().issue, /armazenamento/);
  const noLocks = fixture({ lock: undefined }).create();
  await noLocks.login(credentials);
  await assert.rejects(noLocks.refresh("v1.access.0"));
  assert.equal(noLocks.store.getState().status, "anonymous");
  assert.match(noLocks.store.getState().issue, /navegador/);
});
test("restoration validates trusted identity rather than trusting local user or expiry", async () => {
  const f = fixture(), a = f.create(); await a.login(credentials);
  const value = JSON.parse(f.raw()); value.session.user.id = 999; value.session.expiresAt += 9999999; f.write(JSON.stringify(value));
  const b = f.create(); await b.initialize();
  assert.equal(b.store.getState().session.user.id, 42);
  assert.ok(b.store.getState().session.expiresAt < value.session.expiresAt);
});
for (const codes of [[401,200],[401,401],[403],[503],[0]]) test("axios retries only one 401: " + codes.join(","), async () => {
  const f = fixture(), auth = f.create(); await auth.login(credentials);
  let calls = 0;
  const api = axios.create({ adapter: async config => {
    const status = codes[calls++] ?? 200;
    assert.match(config.headers.get("Authorization"), /^Bearer v1\./);
    const response = { status, statusText: "", headers: {}, config, data: {} };
    if (status !== 200) throw new AxiosError("test", "ERR_BAD_RESPONSE", config, {}, status ? response : undefined);
    return response;
  } });
  installAuthInterceptors(api, () => auth);
  if (codes.at(-1) === 200) await api.get("/protected");
  else await assert.rejects(api.get("/protected"));
  assert.equal(calls, codes.length);
  assert.equal(f.rotations(), codes[0] === 401 ? 1 : 0);
  assert.equal(auth.store.getState().status, codes[1] === 401 ? "anonymous" : "authenticated");
});
test("business requests are canceled and stale responses rejected after logout", async () => {
  const f = fixture(), auth = f.create(); await auth.login(credentials);
  let finish, requestSignal;
  const api = axios.create({ adapter: config => new Promise(resolve => { requestSignal = config.signal; finish = () => resolve({ config, data: { secret: true }, status: 200, statusText: "", headers: {} }); }) });
  installAuthInterceptors(api, () => auth);
  const pending = api.get("/protected"); await delay(0); await auth.logout();
  assert.equal(requestSignal.aborted, true);
  finish(); await assert.rejects(pending);
});

test("old validation cannot overwrite a pair rotated by another tab", async () => {
  let finish;
  const f = fixture(), a = f.create(), b = f.create();
  await a.login(credentials); await b.initialize();
  const normal = f.transport.session;
  f.transport.session = () => new Promise(resolve => { finish = resolve; });
  const pending = a.validate(); await delay(0);
  f.transport.session = normal;
  await b.refresh(b.store.getState().session.accessToken);
  finish({ user, expiresAt: Date.now() + 3600000 });
  await pending;
  assert.equal(JSON.parse(f.raw()).session.accessToken, "v1.access.1");
  assert.equal(a.store.getState().status, "authenticated");
});
test("rejected old refresh does not erase a newer login before storage event delivery", async () => {
  let fail;
  const f = fixture({ transport: { refresh: () => new Promise((_, reject) => { fail = reject; }) } }), a = f.create(), b = f.create();
  await a.login(credentials); await b.initialize();
  const pending = a.refresh(a.store.getState().session.accessToken); await delay(0);
  f.transport.login = async () => session(9);
  await b.login(credentials);
  fail(rejected(401)); await assert.rejects(pending);
  assert.equal(JSON.parse(f.raw()).session.accessToken, "v1.access.9");
  assert.equal(a.store.getState().status, "authenticated");
});
