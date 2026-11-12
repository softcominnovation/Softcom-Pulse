import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import https from "node:https";
import test from "node:test";
import { diagnosticSchema } from "../lib/server/notifications/webhook-diagnostic.ts";
import { postWebhook, webhookRetryMs } from "../lib/server/notifications/webhook-transport.ts";
import { webhookWriteSchema } from "../lib/notifications/webhook.ts";

test("the webhook sends exact JSON and private headers, discards the response and never follows redirects", async t => {
  const calls = [];
  const response = { statusCode: 302, headers: { location: "https://another.example.test/" }, destroy: t.mock.fn() };
  const request = t.mock.method(https, "request", (url, options, onResponse) => {
    const req = new EventEmitter();
    req.end = body => { calls.push({ url: url.href, options, body }); onResponse(response); };
    return req;
  });
  const body = JSON.stringify({ name: "Serviço", eventId: "one" });
  const controller = new AbortController();
  for (const host of ["127.0.0.1", "[::1]", "[::ffff:7f00:1]", "169.254.169.254"]) {
    await assert.rejects(postWebhook("https://" + host, "secret", "one", body, controller.signal));
  }
  const url = "https://192.0.2.17/alerts";
  const result = await postWebhook(url, "secret", "one", body, controller.signal);
  assert.equal(result.status, 302);
  assert.equal(request.mock.callCount(), 1);
  assert.equal(response.destroy.mock.callCount(), 1);
  assert.equal(calls[0].url, url);
  assert.equal(calls[0].options.method, "POST");
  assert.equal(calls[0].body, body);
  assert.deepEqual(calls[0].options.headers, { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body), api_key: "secret", "Idempotency-Key": "one" });
});

test("webhook retry limits, safe details and header validation", () => {
  assert.equal(webhookRetryMs(1, "120"), 120000);
  assert.equal(webhookRetryMs(1, "86400"), 3600000);
  const retry = webhookRetryMs(4, "bad date");
  assert.ok(retry >= 900000 && retry <= 990000);
  const data = { active: true, url: "https://example.test", expectedRevision: 1 };
  for (const apiKey of ["", "   ", "ok\r\nOther: bad", "trailing "]) {
    assert.equal(webhookWriteSchema.safeParse({ ...data, apiKey }).success, false);
  }
  for (const title of ["token=private", "https://user:pass@example.test", "senha: secreta", "injected\u0000"]) {
    const parsed = diagnosticSchema.parse({ title, zabbixEventId: "123" });
    assert.equal(parsed.title, undefined);
    assert.equal(parsed.zabbixEventId, "123");
  }
  assert.equal(diagnosticSchema.parse({ title: "Filesystem somente leitura" }).title, "Filesystem somente leitura");
});
