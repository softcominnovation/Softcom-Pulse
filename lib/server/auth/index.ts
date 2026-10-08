import "server-only";
import { z } from "zod";
import { loginSchema } from "../../auth/contracts.ts";
import { AuthError, authFailure, authJson } from "./errors.ts";
import { openEnvelope } from "./envelope.ts";
import { corporateRequest, issueSession } from "./corporate.ts";
import { isEditor } from "./editors.ts";

const refreshBody = z.object({ refreshToken: z.string().min(1).max(131072) });

async function readBody(request: Request) {
  try {
    const text = await request.text();
    if (text.length > 262144) throw new Error();
    return JSON.parse(text) as unknown;
  } catch { throw new AuthError(400, "invalid_request"); }
}

export function requireSession(request: Request) {
  const match = /^Bearer (\S+)$/i.exec(request.headers.get("Authorization") ?? "");
  if (!match) throw new AuthError();
  return openEnvelope(match[1], "access");
}

export async function login(request: Request) {
  try {
    const body = loginSchema.safeParse(await readBody(request));
    if (!body.success) throw new AuthError(400, "invalid_request");
    return authJson(issueSession(await corporateRequest("login", body.data)));
  } catch (error) { return authFailure(error); }
}
export async function refresh(request: Request) {
  try {
    const body = refreshBody.safeParse(await readBody(request));
    if (!body.success) throw new AuthError();
    const previous = openEnvelope(body.data.refreshToken, "refresh");
    return authJson(issueSession(await corporateRequest("refresh", { refreshToken: previous.token }), previous));
  } catch (error) { return authFailure(error); }
}
export async function logout(request: Request) {
  try {
    const body = refreshBody.safeParse(await readBody(request));
    if (!body.success) throw new AuthError();
    const previous = openEnvelope(body.data.refreshToken, "refresh");
    await corporateRequest("logout", { refreshToken: previous.token });
    return authJson({ revoked: true });
  } catch (error) { return authFailure(error); }
}
export async function session(request: Request) {
  try {
    const envelope = requireSession(request);
    return authJson({ user: envelope.user, expiresAt: envelope.expiresAt, editor: isEditor(envelope.user.email) });
  } catch (error) { return authFailure(error); }
}
