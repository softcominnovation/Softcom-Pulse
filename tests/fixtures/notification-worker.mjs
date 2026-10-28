import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import { join } from "node:path";

// Resolve production imports from the packaged checkout, never from the source tree.
assert.match(process.cwd(), /[\\/]\.next[\\/]standalone$/);
const load = path => import(pathToFileURL(join(process.cwd(), path)).href);
const { getDatabase } = await load("lib/server/database.ts");
const { sealVpsMonitorKey } = await load("lib/server/vps/secret.ts");
const { runProbeCycle } = await load("lib/server/probe/cycle.ts");
const { runVpsMonitorCycle } = await load("lib/server/vps/cycle.ts");
const { runSignalMonitorCycle } = await load("lib/server/signal/cycle.ts");
const pool = getDatabase(), healthy = process.argv[2] === "healthy";
try {
  if (healthy) {
    await pool.query("INSERT INTO external_service(display_name,critical,method,url,success_mode,auth_mode,expected_statuses) VALUES('Runtime probe',true,'GET','https://monitor.example.test','http_status','none','{200}')");
    await pool.query("INSERT INTO standalone_vps(name,ip,critical,base_url,api_key_ciphertext) VALUES('Runtime VPS','127.0.0.1',true,'http://127.0.0.1:1',$1)", [sealVpsMonitorKey("runtime-key")]);
    await pool.query("INSERT INTO signal_target(id,display_name,critical,base_url) VALUES(gen_random_uuid(),'Runtime Signal',true,'http://127.0.0.1:1')");
  }
  await runProbeCycle({ transport: async () => ({ status: healthy ? 200 : 500, body: "", latencyMs: 1, certNotAfter: null }) });
  await runVpsMonitorCycle({ transport: async () => ({ status: healthy ? 200 : 500, body: JSON.stringify({ cpu: { load: "10%" } }), latencyMs: 1 }) });
  const targets = (await pool.query("SELECT id,base_url AS \"baseUrl\",timeout_ms AS \"timeoutMs\" FROM signal_target")).rows;
  const result = healthy ? { ok: true, status: 200, latencyMs: 1, body: { status: "ok" } } : { ok: false, status: 500, latencyMs: 1, error: "http" };
  await runSignalMonitorCycle({ targets, transport: async () => ({ live: result, ready: result }) });
  const states = (await pool.query("SELECT target_ref,checkpoint->>'confirmed' AS state FROM notification_target_state WHERE condition_key='availability'")).rows;
  assert.equal(states.length, 3, JSON.stringify(states));
  if (healthy) assert.ok(states.every(row => row.state === "healthy"), JSON.stringify(states));
  if (process.argv[2] === "confirmed") {
    const events = (await pool.query("SELECT source FROM notification_incident WHERE status='active' ORDER BY source")).rows;
    assert.deepEqual(events.map(row => row.source), ["probe", "signal", "vps"]);
    assert.equal((await pool.query("SELECT count(*)::int AS count FROM notification_event WHERE announce")).rows[0].count, 3);
  }
} finally {
  if (globalThis.pulseCache?.isOpen) await globalThis.pulseCache.quit();
  if (globalThis.pulsePrisma) await globalThis.pulsePrisma.$disconnect();
  await pool.end();
}
