import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { setTimeout as delay } from "node:timers/promises";
import { zabbixCall } from "../lib/server/zabbix/client.ts";

test("Zabbix client permits only read methods, limits concurrency and sanitizes failures", async () => {
  let active = 0, maximum = 0, requests = 0;
  const original = { url: process.env.ZABBIX_API_URL, token: process.env.ZABBIX_API_TOKEN };
  const server = createServer(async (req, res) => {
    const parts = []; for await (const part of req) parts.push(part);
    const request = JSON.parse(Buffer.concat(parts)); requests++;
    assert.equal(req.headers.authorization, request.method === "apiinfo.version" ? undefined : "Bearer test-secret");
    active++; maximum = Math.max(maximum, active); await delay(request.params.hold ? 100 : 10); active--;
    if (request.params.redirect) { res.writeHead(302, { Location: "/forbidden" }); res.end(); return; }
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify(request.params.fail ? { jsonrpc: "2.0", id: request.id, error: { data: "test-secret private detail" } } : { jsonrpc: "2.0", id: request.id, result: request.method === "apiinfo.version" ? "7.0.31" : [] }));
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  process.env.ZABBIX_API_URL = `http://127.0.0.1:${server.address().port}/api_jsonrpc.php`; process.env.ZABBIX_API_TOKEN = "test-secret";
  try {
    await assert.rejects(zabbixCall("host.update", {}), /forbidden/); assert.equal(requests, 0);
    assert.equal(await zabbixCall("apiinfo.version", {}), "7.0.31");
    await Promise.all(Array.from({ length: 12 }, () => zabbixCall("host.get", {})));
    assert.ok(maximum <= 3);
    for (const params of [{ fail: true }, { redirect: true }]) await assert.rejects(zabbixCall("item.get", params), e => e.status === 503 && !JSON.stringify(e).includes("test-secret") && !e.message.includes("private"));
    const stop = new AbortController(); stop.abort(); await assert.rejects(zabbixCall("item.get", {}, stop.signal), /cancelled/);
    const held = Array.from({ length: 3 }, () => zabbixCall("host.get", { hold: true }));
    const queuedAbort = new AbortController(); const queued = zabbixCall("item.get", {}, queuedAbort.signal); queuedAbort.abort();
    await assert.rejects(queued, /cancelled/); await Promise.all(held);
    assert.deepEqual(await zabbixCall("host.get", {}), [], "cancelling a queued request must not leak a concurrency slot");
  } finally {
    for (const [key, value] of [["ZABBIX_API_URL", original.url], ["ZABBIX_API_TOKEN", original.token]]) if (value === undefined) delete process.env[key]; else process.env[key] = value;
    await new Promise(resolve => server.close(resolve));
  }
});
