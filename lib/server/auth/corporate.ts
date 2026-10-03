import "server-only";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { userSchema, type AuthUser } from "../../auth/contracts.ts";
import { AuthError } from "./errors.ts";
import { sealEnvelope, type Envelope } from "./envelope.ts";

export async function corporateRequest(action: "login" | "refresh" | "logout", body: unknown) {
  let base: URL;
  try {
    base = new URL(process.env.API_BASE_URL || process.env.CORPORATE_API_URL || "https://api.softcom.cloud");
    if (!["https:", "http:"].includes(base.protocol) || base.username || base.password || base.search || base.hash) throw new Error();
    if (base.protocol === "http:" && !["localhost", "127.0.0.1", "[::1]"].includes(base.hostname)) throw new Error();
  } catch { throw new AuthError(503, "auth_unavailable"); }
  try {
    const response = await fetch(base.href.replace(/\/+$/, "") + "/v1/auth/" + action, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body), cache: "no-store", redirect: "error", signal: AbortSignal.timeout(10_000),
    });
    if (response.status === 401 || response.status === 403) throw new AuthError(401, action === "login" ? "credentials_invalid" : "session_invalid");
    if (response.status === 429) throw new AuthError(429, "rate_limited");
    if (!response.ok) throw new AuthError(502, "auth_unavailable");
    if (action === "logout") return null;
    return await response.json() as unknown;
  } catch (error) {
    if (error instanceof AuthError) throw error;
    throw new AuthError(503, "auth_unavailable");
  }
}

const tokensSchema = z.object({
  accessToken: z.string().min(1).max(32768),
  refreshToken: z.string().min(1).max(32768),
  expiresIn: z.unknown().optional(),
  user: userSchema.partial().optional(),
});

export function issueSession(value: unknown, previous?: Envelope, now = Date.now()) {
  const parsed = tokensSchema.safeParse(value);
  if (!parsed.success) throw new AuthError(502, "auth_unavailable");
  const tokens = parsed.data;
  const user = userSchema.safeParse({ ...previous?.user, ...tokens.user });
  if (!user.success || (previous && user.data.id !== previous.user.id)) throw new AuthError(502, "auth_unavailable");
  const ttl = typeof tokens.expiresIn === "number" && Number.isFinite(tokens.expiresIn) && tokens.expiresIn > 0 ? tokens.expiresIn : 7200;
  let expiresAt = now + ttl * 1000;
  // exp only caps the validity of a token obtained directly from the trusted upstream.
  try {
    const jwt = JSON.parse(Buffer.from(tokens.accessToken.split(".")[1], "base64url").toString("utf8"));
    if (typeof jwt.exp === "number" && Number.isFinite(jwt.exp)) expiresAt = Math.min(expiresAt, jwt.exp * 1000);
  } catch { /* Opaque access tokens rely on the upstream TTL. */ }
  if (!Number.isFinite(expiresAt) || expiresAt <= now) throw new AuthError(502, "auth_unavailable");
  const context: { sessionId: string; user: AuthUser } = { sessionId: previous?.sessionId ?? randomUUID(), user: user.data };
  return {
    accessToken: sealEnvelope({ ...context, type: "access", token: tokens.accessToken, expiresAt }),
    refreshToken: sealEnvelope({ ...context, type: "refresh", token: tokens.refreshToken }),
    tokenType: "Bearer" as const, expiresIn: (expiresAt - now) / 1000, expiresAt, user: user.data,
  };
}
