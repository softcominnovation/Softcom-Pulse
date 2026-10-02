import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import { fork } from "node:child_process";
import { fileURLToPath } from "node:url";
import { mkdir, readFile, rm } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";
import pg from "pg";
import { withMigrationLock } from "../../docker/migration-lock.mjs";
import { runMigrationProcess } from "../../docker/migrate.mjs";

let admin, connectionString;
const databaseName = "pulse_phase01_test_" + process.pid + "_" + Date.now();
const fixture = fileURLToPath(new URL("../fixtures/migration-worker.mjs", import.meta.url));
const marker = fileURLToPath(new URL("../../.cache/migration-" + process.pid + ".txt", import.meta.url));
before(async () => {
  const source = new URL(process.env.DATABASE_URL);
  assert.ok(["localhost", "127.0.0.1", "[::1]"].includes(source.hostname), "Integration tests require local PostgreSQL.");
  source.pathname = "/postgres";
  admin = new pg.Client({ connectionString: source.href, connectionTimeoutMillis: 3000 });
  await admin.connect();
  await admin.query('CREATE DATABASE "' + databaseName + '"');
  source.pathname = "/" + databaseName;
  connectionString = source.href;
  await mkdir(new URL("../../.cache/", import.meta.url), { recursive: true });
});
after(async () => {
  await rm(marker, { force: true });
  if (admin) {
    assert.match(databaseName, /^pulse_phase01_test_\d+_\d+$/);
    await admin.query('DROP DATABASE IF EXISTS "' + databaseName + '" WITH (FORCE)');
    await admin.end();
  }
});
test("two real processes serialize Prisma migrate deploy", { timeout: 45000 }, async () => {
  const start = () => new Promise((resolve, reject) => {
    const events = [];
    const child = fork(fixture, { env: { ...process.env, DATABASE_URL: connectionString }, stdio: ["ignore", "ignore", "ignore", "ipc"], windowsHide: true, execArgv: [] });
    child.on("message", event => events.push(event));
    child.once("error", reject);
    child.once("exit", code => code === 0 ? resolve(events) : reject(new Error("Migration worker failed.")));
  });
  const runs = await Promise.all([start(), start()]);
  const intervals = runs.map(events => {
    assert.deepEqual(events.map(event => event.type), ["start", "end"]);
    return events.map(event => event.at);
  }).sort((a, b) => a[0] - b[0]);
  assert.ok(intervals[1][0] >= intervals[0][1], "Migrations must not overlap.");
});
test("migration failure prevents application startup and releases the lock", async () => {
  let started = false;
  await assert.rejects(async () => {
    await withMigrationLock({ connectionString, execute: signal => runMigrationProcess(signal, { args: ["-e", "process.exit(7)"] }) });
    started = true;
  }, /failed/);
  assert.equal(started, false);
  await withMigrationLock({ connectionString, waitMs: 1000, execute: async () => {} });
});
test("losing the PostgreSQL session aborts the migration child", { timeout: 10000 }, async () => {
  let killer;
  const code = 'const fs=require("node:fs"); fs.writeFileSync(process.argv[1],"started"); setTimeout(()=>fs.writeFileSync(process.argv[1],"finished"),2000);';
  await assert.rejects(withMigrationLock({
    connectionString,
    onLocked: async client => {
      const { rows } = await client.query("SELECT pg_backend_pid() AS pid");
      killer = (async () => {
        for (let count = 0; count < 100; count++) {
          if (await readFile(marker, "utf8").catch(() => "") === "started") break;
          await delay(20);
        }
        await admin.query("SELECT pg_terminate_backend($1)", [rows[0].pid]);
      })();
    },
    execute: signal => runMigrationProcess(signal, { args: ["-e", code, marker] }),
  }), /lost|failed|retained/);
  await killer;
  await delay(2200);
  assert.equal(await readFile(marker, "utf8"), "started");
  await withMigrationLock({ connectionString, waitMs: 1000, execute: async () => {} });
});
test("lock contention has a finite wait", async () => {
  const holder = new pg.Client({ connectionString });
  await holder.connect();
  try {
    await holder.query("SELECT pg_advisory_lock(734021001::bigint)");
    await assert.rejects(withMigrationLock({ connectionString, waitMs: 150, execute: async () => assert.fail("Must not migrate without lock") }), /timed out/);
  } finally { await holder.end(); }
});
test("an unavailable database cannot wait indefinitely", { timeout: 5000 }, async () => {
  const unavailable = new URL(connectionString);
  unavailable.port = "1";
  const began = Date.now();
  await assert.rejects(withMigrationLock({ connectionString: unavailable.href, waitMs: 250, connectMs: 100, execute: async () => assert.fail() }), /timed out/);
  assert.ok(Date.now() - began < 3000);
});
