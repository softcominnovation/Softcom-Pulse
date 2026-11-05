import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawn, execFileSync } from "node:child_process";
import { createServer } from "node:net";
import { setTimeout as delay } from "node:timers/promises";
import pg from "pg";
import { copyPortableRuntime } from "../../scripts/runtime-links.mjs";

test("standalone outside the repository runs all workers and real locked migrations without installed app dependencies", { timeout: 180000 }, async () => {
  const runtime = await mkdtemp(join(tmpdir(), "pulse-package-test-"));
  const db = new URL(process.env.DATABASE_URL);
  assert.ok(["127.0.0.1", "localhost", "[::1]"].includes(db.hostname));
  const databaseName = "pulse_package_test_" + process.pid + "_" + Date.now();
  db.pathname = "/postgres";
  const admin = new pg.Client({ connectionString: db.href });
  let created = false;
  try {
    await copyPortableRuntime(resolve(".next/standalone"), runtime);
    // Keep native libraries in a child process so Windows can release their DLLs
    // before this test removes its temporary runtime directory.
    execFileSync(process.execPath, [resolve("scripts/verify-runtime.mjs"), runtime], {
      cwd: runtime, windowsHide: true, timeout: 120000, stdio: "pipe",
    });
    await admin.connect();
    await admin.query('CREATE DATABASE "' + databaseName + '"'); created = true;
    db.pathname = "/" + databaseName;
    const migrate = () => new Promise((resolve, reject) => {
      const child = spawn(process.execPath, ["docker/migrate.mjs"], { cwd: runtime, windowsHide: true, timeout: 60000,
        env: { ...process.env, DATABASE_URL: db.href }, stdio: "pipe" });
      let output = "";
      child.stdout.on("data", data => { output += data; });
      child.stderr.on("data", data => { output += data; });
      child.on("error", reject);
      child.on("exit", code => code === 0 ? resolve() : reject(new Error("Packaged migration failed: " + output)));
    });
    // Two image processes must still serialize; the second observes already-applied migrations.
    await Promise.all([migrate(), migrate()]);
    const client = new pg.Client({ connectionString: db.href });
    await client.connect();
    try {
      const result = await client.query('SELECT count(*)::int AS count FROM "_prisma_migrations" WHERE finished_at IS NOT NULL');
      assert.ok(result.rows[0].count > 0);
    } finally { await client.end(); }
    const probe = createServer();
    await new Promise(resolve => probe.listen(0, "127.0.0.1", resolve));
    const port = probe.address().port;
    await new Promise(resolve => probe.close(resolve));
    const server = spawn(process.execPath, ["server.js"], { cwd: runtime, windowsHide: true, stdio: "ignore",
      env: { ...process.env, NODE_ENV: "production", HOSTNAME: "127.0.0.1", PORT: String(port), DATABASE_URL: db.href, REDIS_URL: "redis://127.0.0.1:1" } });
    const exited = new Promise(resolve => server.once("exit", resolve));
    try {
      let ready = false;
      for (let attempt = 0; attempt < 150 && server.exitCode === null; attempt++) {
        ready = await fetch(`http://127.0.0.1:${port}/login`).then(response => response.ok).catch(() => false);
        if (ready) break;
        await delay(100);
      }
      assert.ok(ready, "Next must start from the isolated package");
      const health = await fetch(`http://127.0.0.1:${port}/api/health`);
      assert.equal(health.status, 503);
      assert.equal((await health.json()).checks.database, "up");
    } finally {
      server.kill();
      await Promise.race([exited, delay(1500).then(() => { server.kill("SIGKILL"); return exited; })]);
    }
  } finally {
    if (created) await admin.query('DROP DATABASE "' + databaseName + '" WITH (FORCE)');
    await admin.end();
    // Only the unique directory allocated by mkdtemp for this test is removed.
    assert.equal(resolve(runtime).startsWith(resolve(tmpdir()) + requireSeparator()), true);
    await rm(runtime, { recursive: true, force: true });
  }
});

function requireSeparator() { return process.platform === "win32" ? "\\" : "/"; }
