import "server-only";
import { randomUUID } from "node:crypto";

type Context = { request?: Request; path?: string; method?: string; status: number; code: string; error: unknown };
const repetitions = new Map<string, { at: number; suppressed: number }>();
const identifier = (value: unknown) => typeof value === "string" && /^[A-Za-z0-9_]{1,80}$/.test(value) ? value : undefined;

export function logSessionSizes(data: { sessionId: string; operation: "login" | "refresh"; corporateAccessBytes: number; userBytes: number; accessCount: number; permissionCount: number; accessEnvelopeBytes: number; refreshEnvelopeBytes: number }) {
  try { console.info(JSON.stringify({ event: "auth_session_issued", timestamp: new Date().toISOString(), ...data })); }
  catch { /* Size telemetry must never interrupt authentication. */ }
}

export function diagnosticPath(value: string) {
  try {
    return new URL(value, "http://diagnostic.invalid").pathname.split("/").map(part =>
      /^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(part) ? ":id" : /^[a-zA-Z0-9_-]{0,64}$/.test(part) ? part : ":value",
    ).join("/").slice(0, 256);
  } catch { return "/:unknown"; }
}

function errorDetails(error: unknown, depth = 0): unknown {
  if (!(error instanceof Error) || depth > 2) return undefined;
  const details = error as Error & { code?: unknown; reason?: unknown; upstreamStatus?: unknown; digest?: unknown };
  // Error messages, SQL, upstream bodies, headers and stack arguments may contain secrets.
  const frames = (error.stack ?? "").split("\n").filter(line => /^\s+at /.test(line)).flatMap(line => {
    const match = /[/\\]([^/\\()\s:]{1,80}\.[cm]?[jt]sx?):(\d+):(\d+)\)?$/.exec(line);
    return match ? [`${match[1]}:${match[2]}:${match[3]}`] : [];
  }).slice(0, 5);
  return { type: identifier(error.name), code: identifier(details.code), reason: identifier(details.reason),
    upstreamStatus: typeof details.upstreamStatus === "number" ? details.upstreamStatus : undefined,
    digest: identifier(details.digest), frames, cause: errorDetails(error.cause, depth + 1) };
}

export function logRequestFailure({ request, path, method, status, code, error }: Context) {
  const incomingId = request?.headers.get("x-request-id");
  const requestId = incomingId && /^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(incomingId) ? incomingId : randomUUID();
  try {
    const route = diagnosticPath(request?.url ?? path ?? "/"), verb = identifier(request?.method ?? method) ?? "UNKNOWN";
    const details = errorDetails(error), now = Date.now();
    const key = `${verb}:${route}:${status}:${code}:${JSON.stringify(details)}`;
    const previous = repetitions.get(key);
    if (previous && now - previous.at < 30000) { previous.suppressed++; return requestId; }
    if (!previous && repetitions.size >= 256) repetitions.delete(repetitions.keys().next().value!);
    repetitions.set(key, { at: now, suppressed: 0 });
    console.error(JSON.stringify({ event: "application_request_failed", timestamp: new Date(now).toISOString(),
      level: status >= 500 ? "error" : "warn", requestId, method: verb, path: route, status, code: identifier(code),
      authorizationBytes: request ? Buffer.byteLength(request.headers.get("authorization") ?? "") : undefined,
      cookieBytes: request ? Buffer.byteLength(request.headers.get("cookie") ?? "") : undefined,
      suppressedSinceLast: previous?.suppressed || undefined, error: details }));
  } catch { /* Observability must never replace the original response. */ }
  return requestId;
}
