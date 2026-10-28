import { before, after, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID, randomBytes } from "node:crypto";
import pg from "pg";
import { withMigrationLock } from "../../docker/migration-lock.mjs";
import { runMigrationProcess } from "../../docker/migrate.mjs";
import { getDatabase } from "../../lib/server/database.ts";
import { notificationTargets } from "../../lib/server/notifications/targets.ts";
import { recordNotificationObservations } from "../../lib/server/notifications/engine.ts";
import { httpNotificationObservation } from "../../lib/server/notifications/http.ts";
import { notificationListQuery } from "../../lib/notifications/contracts.ts";
import { listNotifications, notificationChanges, markNotificationsRead, notificationDetail } from "../../lib/server/notifications/read.ts";
import { notificationTransaction, appendChange } from "../../lib/server/notifications/database.ts";
import { maintainNotifications } from "../../lib/server/notifications/maintenance.ts";
import { notificationSettings, saveNotificationSettings } from "../../lib/server/notifications/settings.ts";
import { sealEnvelope } from "../../lib/server/auth/envelope.ts";
import { notificationsGet, notificationsPost, notificationSettingsGet, notificationSettingsPut } from "../../lib/server/notifications/handlers.ts";
import { publicGet } from "../../lib/server/monitoring/public-handlers.ts";

const databaseName = `pulse_notifications_test_${process.pid}_${Date.now()}`;
const original = process.env.DATABASE_URL;
const savedAuth = Object.fromEntries(["TOKEN_ENCRYPTION_KEY", "PULSE_EDITOR_EMAILS", "PULSE_PUBLIC_HOSTS"].map(key => [key, process.env[key]]));
let admin, created = false;
before(async () => {
  process.env.TOKEN_ENCRYPTION_KEY = randomBytes(32).toString("base64"); process.env.PULSE_EDITOR_EMAILS = "editor@example.test"; process.env.PULSE_PUBLIC_HOSTS = "localhost";
  const url = new URL(process.env.DATABASE_URL);
  assert.ok(["localhost", "127.0.0.1", "[::1]"].includes(url.hostname));
  url.pathname = "/postgres";
  admin = new pg.Client({ connectionString: url.href, connectionTimeoutMillis: 3000 }); await admin.connect();
  await admin.query(`CREATE DATABASE "${databaseName}"`); created = true;
  url.pathname = `/${databaseName}`; process.env.DATABASE_URL = url.href;
  await withMigrationLock({ connectionString: url.href, execute: signal => runMigrationProcess(signal) });
});
after(async () => {
  if (globalThis.pulseDatabase) { await globalThis.pulseDatabase.end(); delete globalThis.pulseDatabase; }
  if (created) { assert.match(databaseName, /^pulse_notifications_test_\d+_\d+$/); await admin.query(`DROP DATABASE "${databaseName}" WITH (FORCE)`); }
  if (admin) await admin.end();
  if (original === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = original;
  for (const [key, value] of Object.entries(savedAuth)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
});
beforeEach(async () => {
  await getDatabase().query("DELETE FROM external_service; DELETE FROM notification_event; DELETE FROM notification_incident; DELETE FROM notification_target_state; DELETE FROM notification_change; UPDATE notification_stream_state SET revision=0,minimum_revision=0,delivery_revision=1,maintained_at=NULL; UPDATE pulse_settings SET value='{\"schemaVersion\":1,\"revision\":1}' WHERE key='notifications'");
});
async function target() {
  const id = randomUUID();
  await getDatabase().query(`INSERT INTO external_service(id,display_name,critical,method,url,success_mode,auth_mode) VALUES($1,'Serviço de teste',true,'GET','http://127.0.0.1:1234','http_status','none')`, [id]);
  return (await notificationTargets()).find(target => target.id === id);
}
const query = notificationListQuery.parse({});
const start = () => Date.now() - 180000;
const record = (target, reason, time) => recordNotificationObservations(target, [httpNotificationObservation(target, "probe", reason, new Date(time))], ["availability"]);
async function incident() {
  const selected = await target(), at = start();
  await record(selected, 0, at); await record(selected, 5, at + 60000); await record(selected, 5, at + 120000);
  return { selected, at };
}

test("durable notification transitions deduplicate concurrent samples and share read state", async () => {
  const selected = await target(), at = start();
  await record(selected, 0, at); await record(selected, 5, at + 60000);
  await Promise.all([record(selected, 5, at + 120000), record(selected, 5, at + 120000)]);
  const first = await listNotifications(query);
  assert.equal(first.events.length, 1); assert.equal(first.counts.unreadCount, 1); assert.equal(first.counts.activeCount, 1);
  assert.equal(first.events[0].sound, "error");
  await Promise.all([markNotificationsRead({ ids: [first.events[0].id] }, "one@example.test"), markNotificationsRead({ ids: [first.events[0].id] }, "two@example.test")]);
  const second = await listNotifications(query, "public");
  assert.equal(second.counts.unreadCount, 0); assert.equal(second.counts.activeCount, 1);
  assert.equal(JSON.stringify(second).includes("example.test"), false);
  const changes = await notificationChanges(first.syncCursor, 100, "private");
  assert.equal(changes.changes.length, 1); assert.equal(changes.changes[0].kind, "read");
});

test("configuration changes cancel atomically and stale epochs cannot reopen a monitor", async () => {
  const { selected, at } = await incident();
  await getDatabase().query("UPDATE external_service SET enabled=false WHERE id=$1", [selected.id]);
  const cancelled = await listNotifications(query);
  assert.equal(cancelled.counts.activeCount, 0); assert.equal(cancelled.events[0].incidentStatus, "cancelled");
  await record(selected, 5, at + 121000);
  assert.equal((await listNotifications(query)).events.length, 1);
  await getDatabase().query("DELETE FROM external_service WHERE id=$1", [selected.id]);
  assert.equal((await listNotifications(query)).events.length, 1);
});

test("policy off preserves real incidents and settings enforce revisions and target isolation", async () => {
  const { selected, at } = await incident();
  const settings = await notificationSettings();
  await saveNotificationSettings({ expectedRevision: 1, override: { mode: "off" } }, selected.ref);
  const { schemaVersion, revision, ...values } = settings.data;
  assert.equal(schemaVersion, 1); assert.equal(revision, 1);
  await assert.rejects(saveNotificationSettings({ expectedRevision: 1, settings: values }), error => error.code === "revision_conflict");
  await record(selected, 5, at + 121000);
  assert.equal((await listNotifications(query)).counts.activeCount, 1);
  assert.equal((await listNotifications(query)).events[0].sound, false);
});

test("read-all cutoff excludes new events and paging never advances beyond its captured window", async () => {
  await incident(); const before = await listNotifications(query);
  const second = await target(), at = start();
  await record(second, 0, at); await record(second, 5, at + 60000); await record(second, 5, at + 120000);
  await markNotificationsRead({ allThrough: before.syncCursor }, "editor@example.test");
  const after = await listNotifications(query);
  assert.equal(after.counts.unreadCount, 1);
  await assert.rejects(notificationChanges(before.syncCursor, 1, "public"), error => error.status === 400);
  await assert.rejects(notificationChanges("bad", 1, "private"), error => error.status === 400);
});

test("large immutable windows retain their boundary while later changes remain consumable", async () => {
  const selected = await target(), at = start();
  await recordNotificationObservations(selected, [], ["problems"]);
  const before = await listNotifications(query);
  const rows = Array.from({ length: 205 }, (_, index) => ({ ...httpNotificationObservation(selected, "probe", 5, new Date(at)),
    key: `problem:${index}:1`, family: "problems", source: "zabbix", eventType: "problem", messageCode: "problem",
    observation: { ...httpNotificationObservation(selected, "probe", 5, new Date(at)).observation, confirmation: "explicit", sourceSeverity: 4 } }));
  await recordNotificationObservations(selected, rows, ["problems"]);
  const page = await notificationChanges(before.syncCursor, 200, "private");
  assert.equal(page.changes.length, 200); assert.equal(page.hasMore, true);
  const id = page.changes[0].payload.event.id;
  await markNotificationsRead({ ids: [id] }, "reader@example.test");
  const end = await notificationChanges(page.nextCursor, 200, "private");
  assert.equal(end.changes.length, 5); assert.equal(end.hasMore, false); assert.equal(end.windowEnd, page.windowEnd);
  assert.equal((await notificationChanges(end.nextCursor, 200, "private")).changes[0].kind, "read");
  const historical = await notificationDetail(page.changes[0].payload.incident.id, "public", true);
  assert.equal(historical.events[0].readAt !== null, true); assert.equal(historical.incident.status, "active");
  const next = await notificationChanges(before.syncCursor, 1, "private");
  await saveNotificationSettings({ expectedRevision: 1, override: { sound: "off" } }, selected.ref);
  await assert.rejects(notificationChanges(next.nextCursor, 200, "private"), error => error.status === 409);
});

test("stream lock serializes committed revisions and aborting a transaction leaves no partial writes", async () => {
  const baseline = await listNotifications(query);
  let unlock, locked;
  const ready = new Promise(resolve => { locked = resolve; });
  const held = new Promise(resolve => { unlock = resolve; });
  const first = notificationTransaction(async client => { const revision = await appendChange(client, "read", { ids: [] }); locked(); await held; return revision; });
  await ready;
  const second = notificationTransaction(client => appendChange(client, "read", { ids: [] }));
  assert.equal((await listNotifications(query)).streamRevision, baseline.streamRevision);
  unlock(); const revisions = await Promise.all([first, second]);
  assert.equal(BigInt(revisions[1]), BigInt(revisions[0]) + 1n);
  const feed = await notificationChanges(baseline.syncCursor, 100, "private");
  assert.deepEqual(feed.changes.map(change => change.revision), revisions);
  const abort = new AbortController();
  await assert.rejects(notificationTransaction(async client => { await appendChange(client, "read", {}); abort.abort(); await client.query("SELECT 1"); }, false, abort.signal));
  assert.equal((await listNotifications(query)).streamRevision, revisions[1]);
});

test("source suppression cancels every condition and reappearance establishes new baselines", async () => {
  const { selected, at } = await incident();
  const suppressed = httpNotificationObservation(selected, "probe", 5, new Date(at + 121000));
  suppressed.observation.state = "suppressed";
  await recordNotificationObservations(selected, [suppressed], []);
  assert.equal((await listNotifications(query)).counts.activeCount, 0);
  await record(selected, 5, at + 122000);
  const result = await listNotifications(query);
  assert.equal(result.counts.activeCount, 1); assert.equal(result.events.length, 1);
});

test("retention preserves unread and active incidents and expires old feed cursors", async () => {
  const { selected, at } = await incident();
  const first = await listNotifications(query);
  await record(selected, 0, at + 121000); await record(selected, 0, at + 122000);
  await getDatabase().query("UPDATE notification_incident SET changed_at=now()-interval '40 days' WHERE target_ref=$1", [selected.ref]);
  await maintainNotifications();
  assert.equal((await listNotifications(query)).events.length, 2);
  await markNotificationsRead({ allThrough: (await listNotifications(query)).syncCursor }, "reader@example.test");
  await getDatabase().query("UPDATE notification_event SET read_at=now()-interval '40 days'; UPDATE notification_stream_state SET maintained_at=NULL; UPDATE notification_change SET created_at=now()-interval '8 days'");
  await maintainNotifications();
  assert.equal((await listNotifications(query)).events.length, 0);
  await assert.rejects(notificationChanges(first.syncCursor, 100, "private"), error => error.status === 409);
});

test("a redeployed resolved resource cancels the previous identity without a false recovery", async () => {
  const selected = await target(), at = start();
  const write = (identity, reason, time) => recordNotificationObservations(selected, [{ ...httpNotificationObservation(selected, "probe", reason, new Date(time)), resourceIdentity: identity }], ["availability"]);
  await write("old-container", 0, at); await write("old-container", 5, at + 60000); await write("old-container", 5, at + 120000);
  await write("new-container", 0, at + 121000);
  const result = await listNotifications(query);
  assert.equal(result.events.length, 1); assert.equal(result.events[0].incidentStatus, "cancelled"); assert.equal(result.counts.activeCount, 0);
  await write("old-container", 5, at + 120001);
  assert.equal((await listNotifications(query)).counts.activeCount, 0);
});

test("notification routes enforce private editor writes, public projection, host gates and payload bounds", async () => {
  await incident();
  const token = email => sealEnvelope({ type: "access", token: "test", user: { id: 1, email }, sessionId: randomUUID(), expiresAt: Date.now() + 60000 });
  const request = (method = "GET", body, email, host = "localhost") => new Request("http://localhost/api/monitoring/notifications", {
    method, headers: { host, "Content-Type": "application/json", ...(email ? { Authorization: `Bearer ${token(email)}` } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const context = (...segments) => ({ params: Promise.resolve({ segments }) });
  assert.equal((await notificationsGet(request(), context())).status, 401);
  const history = await publicGet(request(), ["monitoring", "notifications"]); assert.equal(history.status, 200);
  const snapshot = await history.json(), event = snapshot.events[0];
  assert.equal((await publicGet(request("GET", undefined, undefined, "forged.test"), ["monitoring", "notifications"])).status, 403);
  assert.equal((await publicGet(request("POST", { ids: [event.id] }, "editor@example.test"), ["monitoring", "notifications", "read"])).status, 405);
  assert.equal((await publicGet(request(), ["settings", "notifications"])).status, 404);
  assert.equal((await notificationSettingsGet(request("GET", undefined, "reader@example.test"), context())).status, 403);
  assert.equal((await notificationsPost(request("POST", { ids: [event.id] }, "reader@example.test"), context("read"))).status, 403);
  assert.equal((await notificationsPost(request("POST", { ids: [event.id] }, "editor@example.test"), context("read"))).status, 200);
  assert.equal((await notificationSettingsPut(request("PUT", { value: "x".repeat(513 * 1024) }, "editor@example.test"), context())).status, 400);
  assert.equal((await notificationSettingsPut(request("PUT", { value: "x".repeat(65 * 1024) }, "editor@example.test"), context("targets", event.targetRef))).status, 400);
  const publicDetail = await publicGet(request(), ["monitoring", "notifications", event.id]);
  const detail = await publicDetail.json(); assert.equal(publicDetail.status, 200); assert.match(detail.targetHref, /^\/monitor\//);
  const serialized = JSON.stringify(detail);
  for (const forbidden of ["127.0.0.1", "1234", "editor@example", "read_by", "hostid", "condition_key", "override"]) assert.equal(serialized.includes(forbidden), false, forbidden);
  assert.equal((await publicGet(request(), ["monitoring", "notifications", "bad-uuid"])).status, 400);
});
