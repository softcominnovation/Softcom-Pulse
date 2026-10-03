import "server-only";

export class AuthError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status = 401, code = "session_invalid") {
    super(code);
    this.status = status;
    this.code = code;
  }
}
export function authJson(body: unknown, status = 200) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store", Pragma: "no-cache" } });
}
export function authFailure(error: unknown) {
  const failure = error instanceof AuthError ? error : new AuthError(500, "auth_unavailable");
  return authJson({ error: { code: failure.code } }, failure.status);
}
