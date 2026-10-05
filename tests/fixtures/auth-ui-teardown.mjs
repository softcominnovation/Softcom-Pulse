import assert from "node:assert/strict";
import { readFile, rm } from "node:fs/promises";
import pg from "pg";
import { createClient } from "redis";
import dotenv from "dotenv";

export default async function teardown() {
  let record;
  try { record = JSON.parse(await readFile(".cache/ui-runtime.json", "utf8")); }
  catch (error) { if (error.code === "ENOENT") return; throw error; }
  if (!process.env.PULSE_UI_RUN_ID || record.runId !== process.env.PULSE_UI_RUN_ID) return;
  assert.match(record.databaseName, /^pulse_ui05_test_\d+_\d+$/);
  assert.match(record.lease, /^[a-f0-9-]{36}$/);
  dotenv.config({ quiet: true });
  const db = new URL(process.env.DATABASE_URL), redis = new URL(process.env.REDIS_URL);
  for (const url of [db, redis]) assert.ok(["127.0.0.1", "localhost", "[::1]"].includes(url.hostname));
  db.pathname = "/postgres"; redis.pathname = "/11";
  const admin = new pg.Client({ connectionString: db.href }), cache = createClient({ url: redis.href });
  cache.on("error", () => {});
  try {
    await admin.connect(); await cache.connect();
    await admin.query('DROP DATABASE IF EXISTS "' + record.databaseName + '" WITH (FORCE)');
    await cache.eval('if redis.call("GET", KEYS[1]) == ARGV[1] then return redis.call("DEL", KEYS[1]) else return 0 end', { keys: ["pulse:test:ui05:lease"], arguments: [record.lease] });
    await rm(".cache/ui-runtime.json", { force: true });
  } finally { if (cache.isOpen) await cache.quit(); await admin.end(); }
}
