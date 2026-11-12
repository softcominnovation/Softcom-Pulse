import { before, after, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID, randomBytes } from "node:crypto";
import pg from "pg";
import { withMigrationLock } from "../../docker/migration-lock.mjs";
import { runMigrationProcess } from "../../docker/migrate.mjs";
import { getDatabase } from "../../lib/server/database.ts";
import { readWebhookSettings, saveWebhookSettings } from "../../lib/server/notifications/webhook-settings.ts";
import { enqueueWebhookEvents, deliverNextWebhook } from "../../lib/server/notifications/webhook-dispatch.ts";
import { notificationTargets } from "../../lib/server/notifications/targets.ts";
import { recordNotificationObservations } from "../../lib/server/notifications/engine.ts";
import { httpNotificationObservation, recordHttpNotification } from "../../lib/server/notifications/http.ts";
import { classifyProbe } from "../../lib/server/probe/classify.ts";
import { notificationListQuery, notificationHistoryQuery } from "../../lib/notifications/contracts.ts";
import { listNotifications, notificationHistory, notificationChanges, markNotificationsRead, notificationDetail, dismissNotificationIncident } from "../../lib/server/notifications/read.ts";
import { notificationDay } from "../../lib/notifications/history-range.ts";
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
  await getDatabase().query("TRUNCATE notification_webhook_delivery; UPDATE notification_webhook SET active=false, url=NULL, secret=NULL, revision=1, cursor_revision=0, generation=gen_random_uuid()");
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

const endpoint = "https://192.0.2.12/alerts";
const signal = new AbortController().signal;
const configure = async changes => {
  const current = await readWebhookSettings();
  return saveWebhookSettings({ expectedRevision: current.revision, active: current.active, url: current.url, ...changes });
};

test("webhook activation starts after commit and retries independently of notification reads and producers", async () => {
  await incident();
  assert.equal(await enqueueWebhookEvents(), false);
  const settings = await configure({ active: true, url: endpoint, apiKey: "first-key" });
  assert.deepEqual(settings, { revision: 2, active: true, url: endpoint, hasApiKey: true });
  assert.notEqual((await getDatabase().query("SELECT secret FROM notification_webhook")).rows[0].secret, "first-key");
  await incident();
  await Promise.all([enqueueWebhookEvents(), enqueueWebhookEvents()]);
  const deliveries = () => getDatabase().query("SELECT * FROM notification_webhook_delivery ORDER BY due_at");
  const [job] = (await deliveries()).rows;
  assert.equal((await deliveries()).rowCount, 1);
  const { eventId, incidentId, resource, error } = job.body;
  assert.equal(eventId, job.event_id);
  assert.equal(incidentId, job.incident_id);
  assert.equal(resource.name, "Serviço de teste");
  assert.equal(error.context.reason, "timeout");
  const entered = Promise.withResolvers(), finish = Promise.withResolvers();
  const sending = deliverNextWebhook(signal, async (url, key, id, body) => {
    entered.resolve({ url, key, id, body });
    return finish.promise;
  });
  try {
    const posted = await entered.promise;
    assert.deepEqual(posted, { url: endpoint, key: "first-key", id: eventId, body: JSON.stringify(job.body) });
    assert.equal(await deliverNextWebhook(signal), false);
    await markNotificationsRead({ ids: [eventId] }, "reader@example.test");
    await incident();
    assert.equal((await listNotifications(query, "public")).events.length, 3);
    await configure({ apiKey: "rotated-key" });
  } finally { finish.resolve({ status: 503, retryAfter: "120" }); await sending; }
  const retry = (await deliveries()).rows[0];
  assert.equal(retry.finished_at, null);
  assert.equal(retry.attempts, 1);
  assert.ok(retry.due_at.getTime() > Date.now() + 110000);
  await getDatabase().query("UPDATE notification_webhook_delivery SET due_at=now()");
  await deliverNextWebhook(signal, async (_url, key, id, body) => {
    assert.equal(key, "rotated-key"); assert.equal(id, eventId); assert.deepEqual(JSON.parse(body), job.body);
    return { status: 204 };
  });
  assert.equal((await deliveries()).rows[0].outcome, "delivered");
});

test("editors can disable a registered destination even if its DNS has since disappeared", async () => {
  await configure({ active: true, url: endpoint, apiKey: "old-key" });
  await getDatabase().query("UPDATE notification_webhook SET url='https://retired.invalid/alerts'");
  assert.equal((await configure({ active: false })).active, false);
});

test("Zabbix openings and escalations freeze diagnostic context and expose sanitized titles only to private readers", async () => {
  await configure({ active: true, url: endpoint, apiKey: "sentinel" });
  const selected = await target(), at = start();
  await recordNotificationObservations(selected, [], ["problems"]);
  async function problem(rank, title, now) {
    await recordNotificationObservations(selected, [{
      key: "problem:321:123", source: "zabbix", family: "problems", eventType: "problem", messageCode: "problem",
      diagnostic: { title, zabbixEventId: "321", zabbixTriggerId: "123", host: "internal-host" },
      observation: { epoch: selected.epoch, state: "unavailable", severity: "critical", sourceSeverity: rank, checkedAt: now,
        observedAt: now, validUntil: Date.now()+60000, fingerprint: String(rank), confirmation: "explicit" },
    }], ["problems"]);
  }
  await problem(4, "Filesystem somente leitura", at);
  await problem(5, "API_KEY=hidden", at+60000);
  await enqueueWebhookEvents();
  const { rows } = await getDatabase().query("SELECT body FROM notification_webhook_delivery ORDER BY (body->>'sourceSeverity')::int");
  assert.equal(rows.length, 2);
  assert.equal(rows[0].body.error.message, "Filesystem somente leitura");
  assert.equal(rows[0].body.error.context.zabbixTriggerId, "123");
  assert.equal(rows[1].body.error.message, "Problema ativo no Zabbix · severidade 5/5");
  assert.equal(rows[0].body.incidentId, rows[1].body.incidentId);
  assert.notEqual(rows[0].body.eventId, rows[1].body.eventId);
  assert.deepEqual(rows.map(r=>r.body.transition), ["opened","escalated"]);
  for (const scope of ["public","private"]) {
    const history = await listNotifications(query, scope);
    assert.doesNotMatch(JSON.stringify(history), /internal-host|API_KEY=hidden/);
    assert.equal(JSON.stringify(history).includes("Filesystem somente leitura"), scope === "private");
  }
});

test("webhook retains pending events, skips silent and noncritical events and resumes abandoned leases", async () => {
  const db = getDatabase();
  await configure({ active: true, url: endpoint, apiKey: "secret" });
  const { selected } = await incident();
  const event = (await db.query("SELECT * FROM notification_event WHERE target_ref=$1", [selected.ref])).rows[0];
  for (const alteration of ["announce=false", "severity='warning'", "critical_at_occurrence=false", "transition='recovered'"]) {
    await db.query("UPDATE notification_event SET " + alteration + " WHERE id=$1", [event.id]);
    await enqueueWebhookEvents();
    assert.equal((await db.query("SELECT count(*)::int AS n FROM notification_webhook_delivery")).rows[0].n, 0, alteration);
    await db.query("UPDATE notification_event SET severity='critical', announce=true, critical_at_occurrence=true, transition='opened' WHERE id=$1", [event.id]);
    await db.query("UPDATE notification_webhook SET cursor_revision=0");
  }
  await db.query("UPDATE notification_event SET read_at=now()-interval '50 days' WHERE id=$1", [event.id]);
  await db.query("UPDATE notification_incident SET status='resolved', changed_at=now()-interval '50 days' WHERE id=$1", [event.incident_id]);
  await maintainNotifications();
  assert.equal((await db.query("SELECT id FROM notification_event WHERE id=$1", [event.id])).rowCount, 1);
  await enqueueWebhookEvents();
  await db.query("UPDATE notification_stream_state SET maintained_at=NULL");
  await maintainNotifications();
  assert.equal((await db.query("SELECT id FROM notification_event WHERE id=$1", [event.id])).rowCount, 0);
  await db.query("UPDATE notification_webhook_delivery SET lease=gen_random_uuid(),due_at=now()-interval '1 minute'");
  for (let attempt = 1; attempt <= 5; attempt++) {
    assert.ok(await deliverNextWebhook(signal, async () => { throw Object.assign(new Error(), {code:"ETIMEDOUT"}); }));
    const result = (await db.query("SELECT * FROM notification_webhook_delivery")).rows[0];
    assert.equal(result.attempts, attempt);
    assert.equal(result.event_id, event.id);
    assert.equal(result.outcome, "timeout");
    assert.equal(result.finished_at !== null, attempt === 5);
    await db.query("UPDATE notification_webhook_delivery SET due_at=now()");
  }
  assert.equal(await deliverNextWebhook(signal), false);
  // A crash after sending attempt five leaves a lease but no receipt.
  await db.query("UPDATE notification_webhook_delivery SET finished_at=NULL,lease=gen_random_uuid(),due_at=now()");
  let calls = 0;
  await deliverNextWebhook(signal, async () => { calls++; return { status:204 }; });
  assert.equal(calls, 0);
  assert.equal((await db.query("SELECT outcome FROM notification_webhook_delivery")).rows[0].outcome, "receipt_unknown");
});

test("webhook cancels previous destinations and rejects invalid activation or concurrent edits", async () => {
  await assert.rejects(configure({ url: endpoint, active: true }), { code: "invalid_request" });
  const draft = await configure({ apiKey: "secret" });
  assert.equal(draft.active, false);
  await assert.rejects(saveWebhookSettings({ active: false, url: null, expectedRevision: 1 }), { code: "revision_conflict" });
  await configure({ url: endpoint, active: true });
  await incident(); await enqueueWebhookEvents();
  await configure({ url: "https://192.0.2.13/alerts" });
  assert.equal(await deliverNextWebhook(signal), false);
  await assert.rejects(configure({ apiKey: null }), { code: "invalid_request" });
  await incident(); await enqueueWebhookEvents();
  await deliverNextWebhook(signal, async () => ({ status: 401 }));
  assert.equal(await deliverNextWebhook(signal), false);
  const cleared = await configure({ active: false, apiKey: null });
  assert.equal(cleared.hasApiKey, false);
  await incident();
  await configure({ active: true, apiKey: "new-key" });
  await enqueueWebhookEvents();
  assert.equal(await deliverNextWebhook(signal), false);
  const outcomes = await getDatabase().query("SELECT outcome FROM notification_webhook_delivery ORDER BY outcome");
  assert.deepEqual(outcomes.rows.map(r => r.outcome), ["cancelled","http_error"]);
});

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

test("incident highlights survive shared reads and exclude silent baselines, disabled policy and closed incidents", async () => {
  const selected = await target(), baselineOnly = await target(), at = start();
  const initial = await listNotifications(query, "public");
  await record(selected, 0, at);
  await record(selected, 5, at + 60000);
  await record(selected, 5, at + 120000);
  await record(baselineOnly, 5, at);
  const snapshot = () => listNotifications({ ...query, limit: 1, highlights: "1" }, "public");
  const opened = await snapshot(), expected = [{ incidentId: opened.highlights[0].incidentId, targetRef: selected.ref }];
  assert.deepEqual(opened.highlights, expected);
  const delivered = await notificationChanges(initial.syncCursor, 100, "public");
  assert.ok(delivered.changes.some(change => change.payload.incident?.id === expected[0].incidentId && change.payload.highlighted));
  assert.ok(!delivered.changes.some(change => change.payload.incident?.targetRef === baselineOnly.ref && change.payload.highlighted));
  await markNotificationsRead({ ids: [opened.events[0].id] }, "test@example.test");
  assert.deepEqual((await snapshot()).highlights, expected);
  await getDatabase().query("UPDATE external_service SET critical=false WHERE id=$1", [selected.id]);
  assert.deepEqual((await snapshot()).highlights, []);
  await getDatabase().query("UPDATE external_service SET critical=true WHERE id=$1", [selected.id]);
  await record(selected, 0, at + 150000);
  await record(selected, 0, at + 180000);
  assert.deepEqual((await snapshot()).highlights, []);
});

test("two critical VPS can alert together after slow samples; dismissal follows only one occurrence through recovery", async () => {
  const at = Date.now() - 160000, ids = [randomUUID(), randomUUID()];
  try {
    await configure({ active: true, url: endpoint, apiKey: "sentinel" });
    for (const id of ids) await getDatabase().query("INSERT INTO standalone_vps(id,name,ip,critical,base_url,api_key_ciphertext) VALUES($1,$2,'192.0.2.18',true,$3,'fixture')", [id, id, endpoint]);
    const targets = (await notificationTargets()).filter(t => ids.includes(t.id));
    assert.equal(targets.length, 2);
    const sample = (target, code, step) => recordNotificationObservations(target, [httpNotificationObservation(target, "vps", code, new Date(at+step*10000), code === 3 ? 503 : null)], ["availability"]);
    const both = (code, step) => Promise.all(targets.map(t => sample(t, code, step)));
    await both(0,0); await both(1,1); await both(1,2);
    const snapshot = () => listNotifications({ ...query, limit: 1, highlights: "1" }, "public");
    const before = await snapshot();
    await both(3,3); await both(3,4);
    const active = await snapshot();
    assert.equal(active.highlights.length, 2);
    assert.deepEqual(new Set(active.highlights.map(h => h.targetRef)), new Set(targets.map(t => t.ref)));
    assert.match(active.events[0].description, /HTTP 503/);
    const id = active.highlights.find(h => h.targetRef === targets[0].ref).incidentId;
    await enqueueWebhookEvents();
    await Promise.all([dismissNotificationIncident(id, "first"), dismissNotificationIncident(id, "second")]);
    const remaining = await snapshot();
    assert.deepEqual(remaining.highlights.map(h => h.targetRef), [targets[1].ref]);
    assert.deepEqual(remaining.counts, { activeCount: 1, unreadCount: 1 });
    const changes = await notificationChanges(before.syncCursor,100,"public");
    assert.equal(changes.changes.filter(c => c.payload.event?.toastEligible).length, 1);
    assert.equal(changes.changes.filter(c => c.payload.highlighted).length, 1);
    const sent = [];
    while (await deliverNextWebhook(signal, async (_url,_key,_id,json) => { sent.push(JSON.parse(json).resource.ref); return { status: 200 }; })) { /* drain */ }
    assert.deepEqual(sent, [targets[1].ref]);
    await sample(targets[0],3,5); await sample(targets[0],0,6); await sample(targets[0],0,7);
    const old = await notificationDetail(id,"private",true);
    assert.ok(old.incident.dismissedAt); assert.equal(old.incident.status,"resolved"); assert.equal(old.events.length,1);
    await sample(targets[0],3,8); await sample(targets[0],3,9);
    const next = await snapshot();
    assert.equal(next.highlights.length,2); assert.ok(next.highlights.every(h => h.incidentId !== id));
    await enqueueWebhookEvents();
    assert.equal(await deliverNextWebhook(signal, async (_url,_key,_id,json) => { assert.equal(JSON.parse(json).resource.ref,targets[0].ref); return {status:204}; }),true);
  } finally { await getDatabase().query("DELETE FROM standalone_vps WHERE id=ANY($1::uuid[])", [ids]); }
});

test("one healthy probe sample after dismissal rearms alerts for a separately confirmed outage", async () => {
  const probe = await target();
  const at = start();
  const sample = (step, status) => {
    const result = classifyProbe("http_status", [200], null, null, { status, latencyMs: 20 });
    return recordHttpNotification(probe, "probe", result.reason, new Date(at + step * 10000), result.httpStatus);
  };
  const snapshot = () => listNotifications({ ...query, highlights: "1" }, "public");

  await sample(0, 200);
  await sample(1, 404);
  await sample(2, 404);
  const first = await snapshot();
  assert.equal(first.highlights.length, 1);
  const oldId = first.highlights[0].incidentId;
  await dismissNotificationIncident(oldId, "editor");
  const dismissed = await snapshot();
  assert.equal(dismissed.highlights.length, 0);

  await sample(0, 200); // Out-of-order success from before the incident.
  await sample(3, 404);
  await sample(4, 404);
  assert.equal((await notificationDetail(oldId, "private", true)).incident.status, "active");
  assert.equal((await snapshot()).highlights.length, 0);

  await sample(5, 200);
  const closed = await notificationDetail(oldId, "private", true);
  assert.equal(closed.incident.status, "resolved");
  assert.ok(closed.incident.dismissedAt);
  assert.deepEqual(closed.events.map(e => e.transition), ["opened"]);

  await sample(6, 404);
  await sample(6, 404); // Replaying a failed sample cannot confirm a new outage.
  assert.equal((await snapshot()).highlights.length, 0);
  await sample(7, 404);
  const next = await snapshot();
  assert.equal(next.highlights.length, 1);
  const [highlight] = next.highlights;
  assert.equal(highlight.targetRef, probe.ref);
  assert.notEqual(highlight.incidentId, oldId);
  assert.deepEqual(next.counts, { activeCount: 1, unreadCount: 1 });
  const changes = await notificationChanges(dismissed.syncCursor, 100, "public");
  const arrivals = changes.changes.map(change => change.payload.event).filter(event => event?.toastEligible);
  assert.deepEqual(arrivals.map(event => [event.incidentId, event.transition, event.severity]),
    [[highlight.incidentId, "opened", "critical"]]);

  // This new occurrence was never dismissed: its recovery is confirmed and announced normally.
  await sample(8, 200);
  assert.equal((await snapshot()).highlights[0].incidentId, highlight.incidentId);
  await sample(9, 200);
  assert.equal((await snapshot()).highlights.length, 0);
  const recovery = await notificationChanges(next.syncCursor, 100, "public");
  assert.ok(recovery.changes.some(change => change.payload.event?.transition === "recovered"
    && change.payload.event.incidentId === highlight.incidentId && change.payload.event.toastEligible));
});

test("history filters indexed creation times by Fortaleza dates and binds pagination to its range", async () => {
  const {selected}=await incident(), today=notificationDay(), midnight=Date.parse(`${today}T03:00:00Z`), yesterday=notificationDay(midnight-86400000);
  const incidentRow=(await getDatabase().query("SELECT id FROM notification_incident WHERE target_ref=$1",[selected.ref])).rows[0];
  await getDatabase().query("DELETE FROM notification_event");
  const records=[{at:midnight-1,code:"yesterday"},{at:midnight,code:"start"},{at:midnight+60000,code:"middle"},{at:midnight+86400000-1,code:"end"},{at:midnight+86400000,code:"tomorrow"}];
  for(const record of records) {
    record.id=randomUUID();
    await getDatabase().query(`INSERT INTO notification_event(id,incident_id,transition_key,target_ref,display_name,event_type,transition,severity,critical_at_occurrence,message_code,occurred_at,created_at)
      VALUES($1,$2,$3,$4,'History boundary','unavailable','opened',$5,true,'unavailable',$6,$6)`,[record.id,incidentRow.id,record.code,selected.ref,record.code==="middle"?"warning":"critical",new Date(record.at)]);
  }
  const initial=await notificationHistory(notificationHistoryQuery.parse({limit:2}),"private");
  assert.deepEqual(initial.events.map(e=>e.id),[records[3].id,records[2].id]);assert.ok(initial.nextPageCursor);assert.equal(initial.counts.unreadCount,5);
  const second=await notificationHistory(notificationHistoryQuery.parse({limit:2,from:today,cursor:initial.nextPageCursor}),"private");
  assert.deepEqual(second.events.map(e=>e.id),[records[1].id]);assert.equal(second.nextPageCursor,null);
  const past=await notificationHistory(notificationHistoryQuery.parse({from:yesterday}),"private");assert.deepEqual(past.events.map(e=>e.id),[records[0].id]);
  const period=await notificationHistory(notificationHistoryQuery.parse({from:yesterday,to:today}),"private");assert.equal(period.events.length,4);
  const severity=await notificationHistory(notificationHistoryQuery.parse({from:yesterday,to:today,severity:"warning",targetRef:selected.ref}),"private");assert.deepEqual(severity.events.map(e=>e.id),[records[2].id]);
  await assert.rejects(notificationHistory(notificationHistoryQuery.parse({from:yesterday,to:today,cursor:initial.nextPageCursor}),"private"),e=>e.code==="invalid_notification_cursor");
  await assert.rejects(listNotifications(notificationListQuery.parse({cursor:initial.nextPageCursor})),e=>e.code==="invalid_notification_cursor");
  assert.equal((await listNotifications(notificationListQuery.parse({read:"unread"}))).events.length,5);
  await getDatabase().query("UPDATE notification_incident SET opened_at=$2 WHERE id=$1",[incidentRow.id,new Date(midnight-3*86400000)]);
  assert.equal((await listNotifications(query,"private",true)).incidents.length,1);
  assert.equal((await notificationDetail(incidentRow.id,"private",true)).events.length,5);
  const publicHistory=await publicGet(new Request(`http://localhost/api/public/monitoring/notifications/history?from=${yesterday}`,{headers:{host:"localhost"}}),["monitoring","notifications","history"]);
  assert.equal(publicHistory.status,200);assert.equal((await publicHistory.json()).events.length,1);
  const future=await publicGet(new Request("http://localhost/api/public/monitoring/notifications/history?from=9999-01-01",{headers:{host:"localhost"}}),["monitoring","notifications","history"]);
  assert.equal(future.status,400);
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
  assert.equal((await publicGet(request(), ["settings", "notifications", "webhook"])).status, 404);
  assert.equal((await notificationSettingsGet(request(), context("webhook"))).status, 401);
  assert.equal((await notificationSettingsGet(request("GET", undefined, "reader@example.test"), context("webhook"))).status, 403);
  assert.equal((await notificationSettingsPut(request("PUT", {}, "reader@example.test"), context("webhook"))).status, 403);
  const webhook = await notificationSettingsPut(request("PUT", { expectedRevision: 1, active: true, url: endpoint, apiKey: "sentinel" }, "editor@example.test"), context("webhook"));
  assert.equal(webhook.status, 200);
  assert.deepEqual(await webhook.json(), { revision: 2, active: true, url: endpoint, hasApiKey: true });
  assert.equal((await notificationSettingsGet(request("GET", undefined, "editor@example.test"), context("webhook"))).status, 200);
  assert.equal((await notificationSettingsGet(request("GET", undefined, "reader@example.test"), context())).status, 403);
  assert.equal((await notificationsPost(request("POST", { ids: [event.id] }, "reader@example.test"), context("read"))).status, 403);
  assert.equal((await notificationsPost(request("POST", { ids: [event.id] }, "editor@example.test"), context("read"))).status, 200);
  assert.equal((await notificationSettingsPut(request("PUT", { value: "x".repeat(513 * 1024) }, "editor@example.test"), context())).status, 400);
  assert.equal((await notificationSettingsPut(request("PUT", { value: "x".repeat(65 * 1024) }, "editor@example.test"), context("targets", event.targetRef))).status, 400);
  const discard = context("incidents", event.incidentId, "dismiss");
  assert.equal((await notificationsPost(request("POST", {}, "reader@example.test"), discard)).status, 403);
  assert.equal((await publicGet(request("POST", {}, "editor@example.test"), ["monitoring","notifications","incidents",event.incidentId,"dismiss"])).status, 405);
  assert.equal((await notificationsPost(request("POST", {}, "editor@example.test"), discard)).status, 200);
  const publicDetail = await publicGet(request(), ["monitoring", "notifications", event.id]);
  const detail = await publicDetail.json(); assert.equal(publicDetail.status, 200); assert.match(detail.targetHref, /^\/monitor\//);
  const serialized = JSON.stringify(detail);
  for (const forbidden of ["127.0.0.1", "1234", "editor@example", "read_by", "hostid", "condition_key", "override"]) assert.equal(serialized.includes(forbidden), false, forbidden);
  assert.equal((await publicGet(request(), ["monitoring", "notifications", "bad-uuid"])).status, 400);
});

test("Agent usage confirms on distinct evidence and stores immutable warning/recovery context", async () => {
 const { usageRule } = await import("../../lib/server/notifications/usage-rule.ts");
 const config={schemaVersion:1,vmBinding:{parentHostKey:"PARENT",vmKey:"vm-"+"a".repeat(32)},capacity:{filesystemKeys:[],independentVolumesConfirmed:false},thresholds:{cpu:70,memory:null,disk:null}};
 const id=randomUUID(),at=Date.now()-300000;
 await getDatabase().query("INSERT INTO monitored_resource_config(id,resource_type,zabbix_host_key,critical,agent_monitoring) VALUES($1,'host',$2,true,$3)",[id,'agent-'+id,JSON.stringify(config)]);
 const selected=(await notificationTargets()).find(t=>t.id===id);
 const sample=(time,value)=>({key:"metric:cpu",family:"metrics",source:"zabbix",eventType:"usage",messageCode:"usage_cpu",observation:{epoch:selected.epoch,fingerprint:String(time),checkedAt:time,observedAt:time,validUntil:time+600000,state:"unknown",severity:"warning",sourceSeverity:null,confirmation:"explicit"},usage:{metric:"cpu",limit:70,token:String(time),sampleAt:time,validUntil:time+600000,value,rule:usageRule(config,"cpu"),scopeRevision:0},metricContext:{metric:"cpu",valuePercent:value,thresholdPercent:70,recoveryPercent:65,source:"agent",observedAt:new Date(time).toISOString(),coverage:"Agent"}});
 try {
  await recordNotificationObservations(selected,[sample(at,80)],[]);
  assert.equal((await listNotifications(query)).events.length,0);
  await Promise.all([recordNotificationObservations(selected,[sample(at+60000,80)],[]),recordNotificationObservations(selected,[sample(at+60000,80)],[])]);
  let data=await listNotifications(query);assert.equal(data.events.length,1);assert.equal(data.events[0].eventType,"usage");assert.equal(data.events[0].sound,"warning");assert.equal(data.events[0].metricContext.thresholdPercent,70);
  await recordNotificationObservations(selected,[sample(at+120000,60)],[]);await recordNotificationObservations(selected,[sample(at+180000,60)],[]);
  data=await listNotifications(query);assert.equal(data.events.length,2);assert.equal(data.events[0].messageCode,"usage_recovered");assert.equal(data.counts.activeCount,0);
  const detail = await notificationDetail(data.events[0].incidentId,"private",true);
  assert.equal(detail.incident.metricContext.valuePercent,60);assert.equal(detail.incident.contextOccurredAt,data.events[0].occurredAt);
  const changed={...config,thresholds:{...config.thresholds,cpu:90}};
  await getDatabase().query("UPDATE monitored_resource_config SET agent_monitoring=$2 WHERE id=$1",[id,JSON.stringify(changed)]);
  assert.equal((await listNotifications(query)).events.find(e=>e.eventType==="usage").metricContext.thresholdPercent,70);
  assert.equal((await notificationTargets()).find(t=>t.id===id).epoch,selected.epoch);
  const count=(await getDatabase().query("SELECT count(*)::int AS n FROM notification_event WHERE target_ref=$1",[selected.ref])).rows[0].n;
  await recordNotificationObservations(selected,[sample(at+240000,95)],[]);
  assert.equal((await getDatabase().query("SELECT count(*)::int AS n FROM notification_event WHERE target_ref=$1",[selected.ref])).rows[0].n,count);
 } finally { await getDatabase().query("DELETE FROM monitored_resource_config WHERE id=$1",[id]); }
});

test("Collector Agent adapter keeps availability separate and cancels only changed metric rules", async () => {
 const { recordAgentUsage } = await import("../../lib/server/notifications/agent-usage.ts");
 const id=randomUUID(),at=Date.now()-400000,hostKey="agent-"+id,vmKey="vm-"+"b".repeat(32),key="device-"+"c".repeat(32);
 const settings={schemaVersion:1,vmBinding:{parentHostKey:"PARENT",vmKey},capacity:{filesystemKeys:[key],independentVolumesConfirmed:false},thresholds:{cpu:70,memory:null,disk:70}};
 await getDatabase().query("INSERT INTO monitored_resource_config(id,resource_type,zabbix_host_key,critical,agent_monitoring) VALUES($1,'host',$2,true,$3)",[id,hostKey,JSON.stringify(settings)]);
 const selected=(await notificationTargets()).find(t=>t.id===id);
 const m=(value,time,unit="percent")=>({value,unit,quality:"fresh",observedAt:new Date(time).toISOString(),validUntil:new Date(time+600000).toISOString()});
 const parent={vms:[{name:"vm",vmKey,parentHostKey:"PARENT",linuxHostKey:hostKey}]};
 const collect=(time,extra={})=>recordAgentUsage({targets:[selected],configs:[{id,resourceType:"host",zabbixHostKey:hostKey,agentMonitoring:settings}],hosts:[parent,{hostKey,role:"linux",vms:[],metrics:{cpuUsagePercent:m(80,time)},filesystems:[{key,name:"/",metrics:{diskUsedBytes:m(80,time,"bytes"),diskTotalBytes:m(100,at,"bytes")}}],...extra}],disabledHosts:[],checkedAt:time,scopeRevision:0});
 try {
  const availability = (code,time) => { const row=httpNotificationObservation(selected,"probe",code,new Date(time));row.source="zabbix";row.observation.confirmation="explicit";row.observation.validUntil=at+600000;return row; };
  await recordNotificationObservations(selected,[availability(0,at)],["availability"]);
  await recordNotificationObservations(selected,[availability(5,at+1000)],["availability"]);
  await collect(at+10000);await collect(at+70000);
  let active=(await getDatabase().query("SELECT condition_key FROM notification_incident WHERE target_ref=$1 AND status='active'",[selected.ref])).rows.map(r=>r.condition_key);
  assert.ok(active.includes("metric:cpu"));assert.ok(active.includes("metric:disk"));assert.ok(active.some(key=>!key.startsWith("metric:")));
  await collect(at+80000,{filesystems:[]});
  assert.equal((await getDatabase().query("SELECT status FROM notification_incident WHERE target_ref=$1 AND condition_key='metric:disk'",[selected.ref])).rows[0].status,"active");
  await getDatabase().query("UPDATE monitored_resource_config SET agent_monitoring=jsonb_set(agent_monitoring,'{thresholds,cpu}','90') WHERE id=$1",[id]);
  const statuses=(await getDatabase().query("SELECT condition_key,status FROM notification_incident WHERE target_ref=$1",[selected.ref])).rows;
  assert.equal(statuses.find(r=>r.condition_key==="metric:cpu").status,"cancelled");assert.equal(statuses.find(r=>r.condition_key==="metric:disk").status,"active");
  assert.equal(statuses.find(r=>!r.condition_key.startsWith("metric:")).status,"active");
  await collect(at+90000,{vms:[]});
  // The same Agent attached to another VM suppresses usage, without a false recovery.
  parent.vms[0].vmKey="vm-"+"d".repeat(32);await collect(at+100000);
  assert.equal((await getDatabase().query("SELECT status FROM notification_incident WHERE target_ref=$1 AND condition_key='metric:disk'",[selected.ref])).rows[0].status,"cancelled");
 } finally { await getDatabase().query("DELETE FROM monitored_resource_config WHERE id=$1",[id]); }
});

test("Storage disk usage shares durable notifications, cancels only its rule and rejects an obsolete collection", async () => {
 const { recordStorageUsage } = await import("../../lib/server/notifications/storage-usage.ts");
 const id=randomUUID(), at=Date.now()-600000, key="sfs-"+"1".repeat(32), other="sfs-"+"2".repeat(32), storageKey="storage-"+id.replaceAll("-", "");
 await getDatabase().query("INSERT INTO storage_config(id,storage_key,zabbix_host_id,original_name,display_name,critical,filesystem_keys,disk_warning_percent) VALUES($1,$2,'7788','technical-storage','Archive',true,$3,70)",[id,storageKey,JSON.stringify([key])]);
 const selected=(await notificationTargets()).find(target=>target.id===id);
 const m=(value,time)=>({value,unit:"bytes",quality:"fresh",observedAt:new Date(time).toISOString(),validUntil:new Date(at+1200000).toISOString()});
 const snapshot=(time,used=80)=>({status:"ok",absent:[],items:[{hostid:"7788",storageKey,monitoringEnabled:true,classification:{validUntil:new Date(at+1200000).toISOString()},volumes:[{key,name:"/",metrics:{diskUsedBytes:m(used,time),diskTotalBytes:m(100,at)}}]}]});
 const collect=(time,used=80,source=selected)=>recordStorageUsage([source],snapshot(time,used),time);
 try {
  await assert.rejects(getDatabase().query("UPDATE storage_config SET filesystem_keys=NULL WHERE id=$1",[id]), error=>error.code==="23514");
  await collect(at); await collect(at+20000);
  assert.equal((await listNotifications(query)).events.length,0);
  await Promise.all([collect(at+31000),collect(at+31000)]);
  let data=await listNotifications(query); assert.equal(data.events.length,1); assert.equal(data.events[0].targetRef,selected.ref); assert.equal(data.events[0].sound,"warning");
  assert.equal(data.events[0].metricContext.valuePercent,80); assert.equal(data.events[0].metricContext.thresholdPercent,70);
  await markNotificationsRead({ids:[data.events[0].id]},"reader@example.test");
  const beforePresentation = await getDatabase().query("SELECT id,status,condition_key,revision FROM notification_incident WHERE target_ref=$1",[selected.ref]);
  await getDatabase().query('UPDATE storage_config SET card_metrics=$2,revision=revision+1 WHERE id=$1',[id,JSON.stringify(["cpu","memory","disk"])]);
  assert.deepEqual((await getDatabase().query("SELECT id,status,condition_key,revision FROM notification_incident WHERE target_ref=$1",[selected.ref])).rows,beforePresentation.rows);
  assert.equal((await notificationTargets()).find(target=>target.id===id).epoch,selected.epoch);
  await collect(at+40000);
  assert.equal((await listNotifications(query)).events.length,1);
  const failed=snapshot(at+50000,20);failed.status="failed";await recordStorageUsage([selected],failed,at+50000);
  assert.equal((await listNotifications(query)).counts.activeCount,1);
  await collect(at+70000,60); await collect(at+101000,60);
  data=await listNotifications(query);assert.equal(data.events.length,2);assert.equal(data.events[0].messageCode,"usage_recovered");assert.equal(data.counts.activeCount,0);
  const pub=await notificationDetail(data.events[0].incidentId,"public",true);assert.equal(pub.incident.metricContext.thresholdPercent,70);assert.ok(!JSON.stringify(pub).includes('"7788"'));
  const availability=(value,time)=>{const row=httpNotificationObservation(selected,"probe",value,new Date(time));row.source="zabbix";row.observation.confirmation="explicit";row.observation.validUntil=at+1200000;return row;};
  await recordNotificationObservations(selected,[availability(0,at+110000)],["availability"]);
  await recordNotificationObservations(selected,[availability(5,at+120000)],["availability"]);
  await collect(at+130000);await collect(at+161000);
  assert.equal((await getDatabase().query("SELECT count(*)::int AS n FROM notification_incident WHERE target_ref=$1 AND status='active'",[selected.ref])).rows[0].n,2);
  await Promise.all([collect(at+180000),getDatabase().query("UPDATE storage_config SET disk_warning_percent=90,critical=false WHERE id=$1",[id])]);
  const statuses=(await getDatabase().query("SELECT condition_key,status FROM notification_incident WHERE target_ref=$1",[selected.ref])).rows;
  assert.ok(statuses.filter(row=>row.condition_key==="metric:disk").every(row=>row.status!=="active"));
  assert.equal(statuses.find(row=>row.condition_key!=="metric:disk").status,"active");
  const events=(await getDatabase().query("SELECT count(*)::int AS n FROM notification_event WHERE target_ref=$1",[selected.ref])).rows[0].n;
  await collect(at+210000);await collect(at+241000);
  assert.equal((await getDatabase().query("SELECT count(*)::int AS n FROM notification_event WHERE target_ref=$1",[selected.ref])).rows[0].n,events);
  assert.equal((await notificationTargets()).find(target=>target.id===id).epoch,selected.epoch);
  await getDatabase().query("UPDATE storage_config SET disk_warning_percent=70,critical=true WHERE id=$1",[id]);
  const enabled=(await notificationTargets()).find(target=>target.id===id);
  await collect(at+250000,80,enabled);await collect(at+281000,80,enabled);
  await getDatabase().query("UPDATE storage_config SET filesystem_keys=$2 WHERE id=$1",[id,JSON.stringify([other])]);
  assert.equal((await getDatabase().query("SELECT count(*)::int AS n FROM notification_incident WHERE target_ref=$1 AND condition_key='metric:disk' AND status='active'",[selected.ref])).rows[0].n,0);
  const changed=(await notificationTargets()).find(target=>target.id===id);
  for(const time of [at+300000,at+331000]){const source=snapshot(time);source.items[0].volumes[0].key=other;await recordStorageUsage([changed],source,time);}
  assert.equal((await getDatabase().query("SELECT count(*)::int AS n FROM notification_incident WHERE target_ref=$1 AND condition_key='metric:disk' AND status='active'",[selected.ref])).rows[0].n,1);
  await getDatabase().query("UPDATE storage_config SET disk_warning_percent=NULL WHERE id=$1",[id]);
  assert.equal((await getDatabase().query("SELECT count(*)::int AS n FROM notification_incident WHERE target_ref=$1 AND condition_key='metric:disk' AND status='active'",[selected.ref])).rows[0].n,0);
  assert.equal((await getDatabase().query("SELECT status FROM notification_incident WHERE target_ref=$1 AND condition_key='availability'",[selected.ref])).rows[0].status,"active");
 } finally { await getDatabase().query("DELETE FROM storage_config WHERE id=$1",[id]); }
});
