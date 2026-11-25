import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";

test("HTTP observation preserves native rejection, custom listeners and request handling", async () => {
  const originalError = console.error, lines = [];
  console.error = line => lines.push(JSON.parse(line));
  let server;
  try {
    await import("../scripts/http-diagnostics.cjs");
    server = createServer((_request, response) => { response.end("ok"); });
    assert.equal(server.listenerCount("clientError"), 0, "Observation must not take ownership of Node's parser failure");
    await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
    const url = "http://127.0.0.1:" + server.address().port;
    const ok = await fetch(url);
    assert.equal(await ok.text(), "ok");
    assert.match(ok.headers.get("x-request-id"), /^[a-f0-9-]{36}$/);
    const secret = "private-parser-secret";
    const headers = { Authorization: "Bearer " + secret + "x".repeat(24000) };
    const rejected = await fetch(url, { headers });
    assert.equal(rejected.status, 431);
    await rejected.arrayBuffer();
    assert.equal(lines.find(line => line.event === "http_request_rejected").code, "HPE_HEADER_OVERFLOW");
    assert.equal(lines.find(line => line.event === "http_request_rejected").authorizationBytesInChunk, headers.Authorization.length);
    assert.ok(!JSON.stringify(lines).includes(secret));
    server.on("clientError", (_error, socket) => { socket.end("HTTP/1.1 400 Bad Request\r\nConnection: close\r\nContent-Length: 0\r\n\r\n"); });
    const custom = await fetch(url, { headers });
    assert.equal(custom.status, 400, "An existing custom handler retains its behavior");
    await custom.arrayBuffer();
    assert.equal(lines.filter(line => line.event === "http_request_rejected").length, 1, "Repeated parser errors are throttled");
  } finally {
    if (server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
    console.error = originalError;
  }
});
