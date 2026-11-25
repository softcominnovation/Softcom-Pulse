import "server-only";
import { logRequestFailure } from "../diagnostics.ts";

export class AuthError extends Error {
  readonly status: number;
  readonly code: string;
  readonly reason?: string;
  readonly upstreamStatus?: number;
  constructor(status = 401, code = "session_invalid", details?: { reason?: string; upstreamStatus?: number; cause?: unknown }) {
    super(code, { cause: details?.cause });
    this.status = status;
    this.code = code;
    this.reason = details?.reason;
    this.upstreamStatus = details?.upstreamStatus;
  }
}
export function authJson(body: unknown, status = 200) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store", Pragma: "no-cache" } });
}
export function authFailure(error: unknown, request?: Request) {
  const failure = error instanceof AuthError ? error : new AuthError(500, "auth_unavailable");
  const requestId = logRequestFailure({ request, error, status: failure.status, code: failure.code });
  const response = authJson({ error: { code: failure.code } }, failure.status);
  response.headers.set("X-Request-ID", requestId);
  return response;
}
