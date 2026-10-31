import { request as httpRequest } from "node:http";

// Fetch derives Host from the URL; this fixture exercises the actual HTTP Host boundary.
export function getWithHost(url, host, extraHeaders = {}) {
  return new Promise((resolve, reject) => {
    const headers = new Headers(extraHeaders);
    headers.set("host", host);
    const request = httpRequest(url, { method: "GET", agent: false, headers: Object.fromEntries(headers) }, response => {
      const chunks = [];
      response.on("data", chunk => chunks.push(chunk));
      response.once("error", reject);
      response.once("aborted", () => reject(new Error("Host fixture response aborted")));
      response.once("end", () => {
        const incoming = new Headers();
        for (let i = 0; i < response.rawHeaders.length; i += 2) incoming.append(response.rawHeaders[i], response.rawHeaders[i + 1]);
        resolve({ status: response.statusCode, headers: incoming, body: Buffer.concat(chunks).toString("utf8"), sentHost: request.getHeader("host") });
      });
    });
    request.once("error", reject);
    request.setTimeout(10000, () => request.destroy(new Error("Host fixture request timed out")));
    request.end();
  });
}
