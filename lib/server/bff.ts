import "server-only";
import { z, ZodError } from "zod";
import { requireSession } from "./auth/index.ts";
import { isEditor } from "./auth/editors.ts";
import { isPublicHost } from "./auth/public-hosts.ts";
import { AuthError, authJson } from "./auth/errors.ts";
import { logRequestFailure } from "./diagnostics.ts";

export class BffError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string, cause?: unknown) { super(code, { cause }); this.status = status; this.code = code; }
}
function failedResponse(request: Request, error: unknown) {
  const status = error instanceof AuthError || error instanceof BffError ? error.status : error instanceof ZodError ? 400 : 500;
  const code = error instanceof AuthError || error instanceof BffError ? error.code : error instanceof ZodError ? "invalid_request" : "internal_error";
  const requestId = logRequestFailure({ request, error, status, code });
  const body = error instanceof ZodError ? { code, fields: error.issues.map(issue => ({ path: issue.path.map(String).join("."), message: "Valor inválido." })) } : { code };
  const response = authJson({ error: body }, status);
  response.headers.set("X-Request-ID", requestId);
  return response;
}
export async function protectedResponse(request: Request, action: (editor: boolean) => Promise<unknown>, status = 200) {
  try {
    const session = requireSession(request);
    const editor = isEditor(session.user.email);
    if (request.method !== "GET" && request.method !== "HEAD" && !editor) throw new BffError(403, "editor_required");
    const body = await action(editor);
    return status === 204 ? new Response(null, { status, headers: { "Cache-Control": "no-store" } }) : authJson(body, status);
  } catch (error) {
    return failedResponse(request, error);
  }
}
export async function publicResponse(request: Request, action: () => Promise<unknown>, status = 200) {
  let response: Response;
  try {
    if (request.method !== "GET") throw new BffError(405, "method_not_allowed");
    if (!isPublicHost(request)) throw new BffError(403, "host_not_allowed");
    const body = await action();
    response = status === 204 ? new Response(null, { status, headers: { "Cache-Control": "no-store" } }) : authJson(body, status);
  } catch (error) {
    response = failedResponse(request, error);
  }
  if (request.method === "GET" && isPublicHost(request) && !request.headers.has("Authorization")) response.headers.set("Access-Control-Allow-Origin", "*");
  return response;
}
export async function jsonBody(request: Request, maximumBytes = 65536) {
  if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get("Content-Type") ?? "")) throw new BffError(400, "invalid_request");
  const reader = request.body?.getReader();
  if (!reader) throw new BffError(400, "invalid_request");
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > maximumBytes) { await reader.cancel(); throw new BffError(400, "invalid_request"); }
      chunks.push(value);
    }
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
  } catch { throw new BffError(400, "invalid_request"); }
  finally { reader.releaseLock(); }
}
export function queryParams<T>(request: Request, schema: z.ZodType<T>): T {
  const params = new URL(request.url).searchParams;
  if (new Set(params.keys()).size !== [...params.keys()].length) throw new BffError(400, "invalid_request");
  return schema.parse(Object.fromEntries(params));
}
