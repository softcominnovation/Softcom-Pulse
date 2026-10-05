import { spawn } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import pg from "pg";
import { createClient } from "redis";
import dotenv from "dotenv";
import assert from "node:assert/strict";
import { mkdir, writeFile, rm } from "node:fs/promises";
import { startAuthUpstream } from "./auth-upstream.mjs";

dotenv.config({ quiet: true });
const db = new URL(process.env.DATABASE_URL), redis = new URL(process.env.REDIS_URL);
for (const url of [db, redis]) assert.ok(["127.0.0.1", "localhost", "[::1]"].includes(url.hostname));
const databaseName = "pulse_ui05_test_" + process.pid + "_" + Date.now();
db.pathname = "/postgres";
const admin = new pg.Client({ connectionString: db.href });
redis.pathname = "/11";
const cache = createClient({ url: redis.href }); cache.on("error", () => {});
const leaseKey = "pulse:test:ui05:lease", lease = randomUUID();
let owned = false, created = false, recorded = false, closing = false;
async function cleanup() {
  if (closing) return; closing = true;
  if (cache.isReady) { if (owned && await cache.get(leaseKey) === lease) await cache.del(leaseKey); await cache.quit(); }
  if (created) { assert.match(databaseName, /^pulse_ui05_test_\d+_\d+$/); await admin.query('DROP DATABASE IF EXISTS "' + databaseName + '" WITH (FORCE)'); }
  await admin.end();
  if (recorded) await rm(".cache/ui-runtime.json", { force: true });
}
try {
  await admin.connect(); await admin.query('CREATE DATABASE "' + databaseName + '"'); created = true; db.pathname = "/" + databaseName;
  await cache.connect(); assert.equal(await cache.set(leaseKey, lease, { NX: true, EX: 1800 }), "OK"); owned = true;
  assert.equal(await cache.dbSize(), 1, "Redis DB 11 must be empty; existing data is preserved");
  await mkdir(".cache", { recursive: true });
  await writeFile(".cache/ui-runtime.json", JSON.stringify({ databaseName, lease, runId: process.env.PULSE_UI_RUN_ID }), { flag: "wx" }); recorded = true;
  await new Promise((resolve, reject) => {
    const migration = spawn(process.execPath, ["node_modules/prisma/build/index.js", "migrate", "deploy"], { env: { ...process.env, DATABASE_URL: db.href }, windowsHide: true, stdio: "ignore" });
    migration.once("error", reject); migration.once("exit", code => code === 0 ? resolve() : reject(new Error("Test migration failed")));
  });
} catch { await cleanup(); throw new Error("Could not prepare isolated UI database/cache"); }
const upstream = await startAuthUpstream(3102);
const child = spawn(process.execPath, ["node_modules/next/dist/bin/next", "dev", "--hostname", "127.0.0.1", "--port", "3100"], {
  windowsHide: true, stdio: "inherit",
  env: { ...process.env, PULSE_E2E: "1", DATABASE_URL: db.href, REDIS_URL: redis.href, API_BASE_URL: upstream.url, TOKEN_ENCRYPTION_KEY: randomBytes(32).toString("base64") },
});
async function close() { child.kill(); await upstream.close(); await cleanup(); }
process.on("SIGTERM", () => { void close(); });
process.on("SIGINT", () => { void close(); });
child.on("exit", async code => { await upstream.close(); await cleanup(); process.exit(code ?? 0); });
