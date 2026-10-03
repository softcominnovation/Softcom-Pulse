import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";

export async function startAuthUpstream(port = 0) {
  const refreshTokens = new Map(), accounts = new Map();
  const server = createServer(async (request, response) => {
    const json = (value, status = 200) => { response.writeHead(status, { "Content-Type": "application/json" }); response.end(JSON.stringify(value)); };
    const url = new URL(request.url, "http://localhost");
    if (url.pathname === "/test-state") return json(accounts.get(url.searchParams.get("email")) ?? {});
    let body;
    try { let text = ""; for await (const chunk of request) text += chunk; body = JSON.parse(text); }
    catch { return json({}, 400); }
    if (request.headers.authorization || request.headers["x-api-key"]) return json({ error: "Unexpected credential header" }, 400);
    const issue = (email, user) => {
      const accessToken = "test." + Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 7200 })).toString("base64url") + ".test-signature";
      const refreshToken = "test-raw-refresh-" + randomUUID();
      refreshTokens.set(refreshToken, { email, user });
      return { accessToken, refreshToken, tokenType: "Bearer", expiresIn: 7200, ...(user ? { user } : {}) };
    };
    if (url.pathname === "/v1/auth/login") {
      accounts.set(body.email, { logins: (accounts.get(body.email)?.logins ?? 0) + 1, refreshes: 0, logouts: 0 });
      if (body.email.startsWith("slow")) await delay(700);
      if (body.senha !== "test-password") return json({ error: "raw-private-error" }, 401);
      return json(issue(body.email, { id: 42, nome: "Teste", email: body.email, administrador: false, acessos: [], permissoes: [], empresa: "JP", solicitante: 0 }));
    }
    if (url.pathname === "/v1/auth/refresh") {
      const value = refreshTokens.get(body.refreshToken);
      if (!value) return json({}, 401);
      refreshTokens.delete(body.refreshToken);
      accounts.get(value.email).refreshes++;
      await delay(value.email.startsWith("late") ? 700 : 150);
      const pair = issue(value.email, value.user);
      delete pair.user;
      return json(pair);
    }
    if (url.pathname === "/v1/auth/logout") {
      const value = refreshTokens.get(body.refreshToken);
      if (value) accounts.get(value.email).logouts++;
      refreshTokens.delete(body.refreshToken);
      response.writeHead(204); return response.end();
    }
    json({}, 404);
  });
  await new Promise(resolve => server.listen(port, "127.0.0.1", resolve));
  return { url: "http://127.0.0.1:" + server.address().port, close: () => new Promise(resolve => server.close(resolve)) };
}
