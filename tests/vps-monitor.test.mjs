import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { monitorEndpoint, monitorState, standaloneVpsPatchSchema, standaloneVpsWriteSchema, vpsMonitorIntervalMs } from "../lib/config/standalone-vps.ts";
import { classifyVpsCheck } from "../lib/server/vps/classify.ts";
import { parseMonitorStatus } from "../lib/server/vps/status.ts";
import { openProbeSecret } from "../lib/server/probe/secret.ts";
import { openVpsMonitorKey, sealVpsMonitorKey } from "../lib/server/vps/secret.ts";
import { vpsResultPayload } from "../lib/server/vps/store.ts";

test("VPS monitor interval is 60s unless a value from 30s to 120s is set", () => {
  assert.equal(vpsMonitorIntervalMs(undefined), 60000);
  assert.equal(vpsMonitorIntervalMs(""), 60000);
  assert.equal(vpsMonitorIntervalMs("30000"), 30000);
  assert.equal(vpsMonitorIntervalMs("120000"), 120000);
  for (const value of ["29999", "120001", "60000.5", "60s"]) assert.equal(vpsMonitorIntervalMs(value), null, value);
});

test("monitor URLs allow HTTP and private addresses and reject userinfo, query and fragment", () => {
  const saved = standaloneVpsWriteSchema.parse({ name: "Lab", ip: "10.1.1.8", baseUrl: "http://10.1.1.8:9100/monitor/", apiKey: "local-key", managerUrl: "https://10.1.1.8/manager?tab=1" });
  assert.equal(saved.baseUrl, "http://10.1.1.8:9100/monitor");
  assert.equal(saved.managerUrl, "https://10.1.1.8/manager?tab=1");
  assert.equal(monitorEndpoint(saved.baseUrl, "/ping/latency"), "http://10.1.1.8:9100/monitor/ping/latency");
  for (const baseUrl of ["http://user:secret@10.1.1.8/monitor", "https://10.1.1.8/monitor?token=secret", "https://10.1.1.8/monitor#secret", "ftp://10.1.1.8/monitor"]) {
    assert.throws(() => standaloneVpsWriteSchema.parse({ name: "Lab", ip: "10.1.1.8", baseUrl, apiKey: "local-key" }), baseUrl);
  }
  assert.equal(saved.provider, null);
  assert.equal(standaloneVpsWriteSchema.parse({ name: "Lab", ip: "10.1.1.8", provider: " Hostinger " }).provider, "Hostinger");
  assert.equal(standaloneVpsPatchSchema.parse({ expectedRevision: 1, name: "Lab" }).provider, undefined);
  assert.equal(standaloneVpsPatchSchema.parse({ expectedRevision: 1, provider: "" }).provider, null);
  assert.throws(() => standaloneVpsWriteSchema.parse({ name: "Lab", ip: "10.1.1.8", provider: "a".repeat(121) }));
  assert.throws(() => standaloneVpsWriteSchema.parse({ name: "Lab", ip: "10.1.1.8/24" }));
  assert.throws(() => standaloneVpsWriteSchema.parse({ name: "Lab", ip: "10.1.1.8:22" }));
});

test("status parsing keeps comma decimals, units and the busiest disk", () => {
  const reading = parseMonitorStatus(JSON.stringify({
    CPU: { Load: "12,5%", Cores: 4, Speed: "2.4 GHz", CoresLoad: [{ Core: "0", Load: "10%" }] },
    Memory: { Total: "8 GB", Used: "2 GB", Free: "6 GB" },
    Disks: [{ Device: "sda", Type: "disk", Mount: "/", Size: "100 GB", Used: "72 GB", Available: "28 GB", Use: "72%" }, { Device: "sdb", Use: "10%" }],
  }));
  assert.equal(reading.cpuPercent, 12.5);
  assert.equal(reading.memoryPercent, 25);
  assert.equal(reading.diskPercent, 72);
  assert.equal(reading.cpu.cores, 4);
  assert.equal(reading.disks.length, 2);
  assert.equal(parseMonitorStatus("{}").usable, false);
  assert.equal(parseMonitorStatus(JSON.stringify({ cpu: { load: "nope" }, memory: { total: "many", used: "1" }, disks: [] })).cpuPercent, null);
});

test("monitor state treats a missing monitor as not configured and an unusable status as up", () => {
  assert.equal(monitorState(true, false, null), "not_configured");
  assert.equal(monitorState(false, true, 0), "inactive");
  assert.equal(monitorState(true, true, null), "pending");
  assert.equal(monitorState(true, true, 0), "up");
  assert.equal(monitorState(true, true, 1), "up");
  assert.equal(monitorState(true, true, 4), "up");
  assert.equal(monitorState(true, true, 5), "down");
  assert.equal(monitorState(true, true, 0, true), "paused");
  assert.equal(monitorState(false, true, 0, true), "inactive");
  const down = classifyVpsCheck({ error: "timeout" }, null, 5000);
  assert.equal(down.reason, 5);
  assert.equal(down.latencyMs, null);
  const denied = classifyVpsCheck({ status: 401, body: "secret", latencyMs: 20 }, null, 5000);
  assert.equal(denied.reason, 2);
  const unread = classifyVpsCheck({ status: 200, body: "", latencyMs: 30 }, { status: 200, body: "{}", latencyMs: 30 }, 5000);
  assert.equal(unread.reason, 4);
  const slow = classifyVpsCheck({ status: 200, body: "", latencyMs: 3000 }, { status: 200, body: JSON.stringify({ cpu: { load: "1%" } }), latencyMs: 10 }, 5000);
  assert.equal(slow.reason, 1);
});

test("the monitor key uses its own cipher and stays out of the Redis payload", () => {
  process.env.TOKEN_ENCRYPTION_KEY = randomBytes(32).toString("base64");
  const secret = "vps-monitor-secret";
  const sealed = sealVpsMonitorKey(secret);
  assert.equal(sealed.includes(secret), false);
  assert.equal(openVpsMonitorKey(sealed), secret);
  assert.throws(() => openProbeSecret(sealed));
  const payload = JSON.stringify(vpsResultPayload(new Date().toISOString(), 0, 10, parseMonitorStatus(JSON.stringify({ cpu: { load: "1%" } }))));
  assert.equal(payload.includes(secret), false);
  assert.equal(payload.includes("http"), false);
  assert.equal(JSON.parse(payload).apiKey, undefined);
});
