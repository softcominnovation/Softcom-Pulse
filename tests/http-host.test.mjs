import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { getWithHost } from "./fixtures/http-host.mjs";

test("Host fixture transmits the explicit authority while connecting to the loopback server", async () => {
  const received = [];
  const server = createServer((request, response) => {
    received.push({ host: request.headers.host, forwardedHost: request.headers["x-forwarded-host"], origin: request.headers.origin });
    response.writeHead(request.headers.host === "allowed.test" ? 200 : 403, { "Content-Type": "application/json" });
    response.end(JSON.stringify(received.at(-1)));
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  try {
    const url = `http://127.0.0.1:${server.address().port}/monitor?compat=1`;
    const allowed = await getWithHost(url, "allowed.test");
    assert.equal(allowed.status, 200); assert.equal(allowed.sentHost, "allowed.test");
    const blocked = await getWithHost(url, "not-allowed.test", { Origin: "null", "X-Forwarded-Host": "allowed.test" });
    assert.equal(blocked.status, 403); assert.equal(blocked.sentHost, "not-allowed.test");
    assert.deepEqual(JSON.parse(blocked.body), { host: "not-allowed.test", forwardedHost: "allowed.test", origin: "null" });
    assert.equal(received.length, 2);
  } finally {
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});
