/* eslint-disable @typescript-eslint/no-require-imports -- Standalone preload shared by ESM and CommonJS entrypoints. */
const http = require("node:http");
const https = require("node:https");
const { randomUUID } = require("node:crypto");
const { syncBuiltinESMExports } = require("node:module");
const installed = Symbol.for("pulse.http.diagnostics");

if (!http[installed]) {
  http[installed] = true;
  const recent = new Map();
  function write(event) {
    try { console.error(JSON.stringify({ timestamp: new Date().toISOString(), ...event })); } catch { /* Keep HTTP behavior intact. */ }
  }
  for (const transport of [http, https]) {
    const createServer = transport.createServer;
    transport.createServer = function (...options) {
      const server = Reflect.apply(createServer, this, options);
      const emit = server.emit;
      // Observe without adding a clientError listener: Node must keep ownership
      // of its native 431/400 handling and socket cleanup, including the return value.
      server.emit = function (event, ...args) {
        if (event === "clientError") {
          try {
            const error = args[0], code = /^[A-Z0-9_]{1,64}$/.test(error?.code) ? error.code : "HTTP_PARSE_ERROR";
            const now = Date.now(), previous = recent.get(code);
            if (!previous || now - previous.at >= 30000) {
              if (recent.size >= 32) recent.delete(recent.keys().next().value);
              recent.set(code, { at: now, suppressed: 0 });
              const chunk = Buffer.isBuffer(error?.rawPacket) ? error.rawPacket.toString("latin1") : "";
              const observedHeaderBytes = name => new RegExp("\\r\\n" + name + ":[ \\t]*([^\\r\\n]*)", "i").exec(chunk)?.[1].length;
              write({ event: "http_request_rejected", level: "error", requestId: randomUUID(), code,
                maxHeaderBytes: server.maxHeaderSize || http.maxHeaderSize,
                bytesParsed: Number.isSafeInteger(error?.bytesParsed) ? error.bytesParsed : undefined,
                receivedChunkBytes: Buffer.isBuffer(error?.rawPacket) ? error.rawPacket.length : undefined,
                authorizationBytesInChunk: observedHeaderBytes("authorization"), cookieBytesInChunk: observedHeaderBytes("cookie"),
                suppressedSinceLast: previous?.suppressed || undefined });
            } else previous.suppressed++;
          } catch { /* Never affect the parser or include rawPacket/header contents. */ }
        }
        return Reflect.apply(emit, this, [event, ...args]);
      };
      server.prependListener("request", (request, response) => {
        try {
          const requestId = randomUUID();
          request.headers["x-request-id"] = requestId;
          response.setHeader("X-Request-ID", requestId);
        } catch { /* Correlation must not interrupt a request. */ }
      });
      return server;
    };
  }
  syncBuiltinESMExports();
  write({ event: "http_diagnostics_ready", maxHeaderBytes: http.maxHeaderSize });
}
