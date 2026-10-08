import "server-only";
import { z, ZodError } from "zod";
import { requireSession } from "./auth/index.ts";
import { isEditor } from "./auth/editors.ts";
import { AuthError, authJson } from "./auth/errors.ts";

export class BffError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string) { super(code); this.status = status; this.code = code; }
}
export async function protectedResponse(request: Request, action: (editor: boolean) => Promise<unknown>, status = 200) {
  try {
    const session = requireSession(request);
    const editor = isEditor(session.user.email);
    if (request.method !== "GET" && request.method !== "HEAD" && !editor) throw new BffError(403, "editor_required");
    const body = await action(editor);
    return status === 204 ? new Response(null, { status, headers: { "Cache-Control": "no-store" } }) : authJson(body, status);
  } catch (error) {
    if (error instanceof AuthError || error instanceof BffError) return authJson({ error: { code: error.code } }, error.status);
    if (error instanceof ZodError) return authJson({ error: { code: "invalid_request", fields: error.issues.map(issue => ({ path: issue.path.map(String).join("."), message: "Valor inválido." })) } }, 400);
    return authJson({ error: { code: "internal_error" } }, 500);
  }
}
export async function jsonBody(request: Request) {
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
      if (bytes > 65536) { await reader.cancel(); throw new BffError(400, "invalid_request"); }
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
