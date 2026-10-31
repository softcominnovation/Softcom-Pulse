import { readCompatibleMonitor } from "@/lib/server/monitor-compat/read";
import { compatibleMonitorState, renderCompatibleContent, renderCompatibleFailure, renderCompatiblePage } from "@/lib/server/monitor-compat/render";
import { getPublicConfig } from "@/lib/server/public-config";
import { isPublicHost } from "@/lib/server/auth/public-hosts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  if (!isPublicHost(request)) return Response.json({ error: { code: "host_not_allowed" } }, { status: 403, headers: { "Cache-Control": "no-store" } });
  const headers = { "Cache-Control": "no-store", "Access-Control-Allow-Origin": "*", "X-Content-Type-Options": "nosniff" };
  const fragment = new URL(request.url).searchParams.get("fragment") === "1";
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    const model = await Promise.race([readCompatibleMonitor(request), new Promise<never>((_resolve, reject) => { timeout = setTimeout(() => reject(new Error("Monitor deadline")), 8000); })]);
    if (model instanceof Response) {
      if (fragment) return new Response(model.body, { status: model.status, headers: { ...Object.fromEntries(model.headers), ...headers } });
      return new Response(renderCompatibleFailure(model.status === 400 ? "Confira os parâmetros da tela solicitada." : "A configuração pública está temporariamente indisponível.", getPublicConfig().appName), { status: model.status, headers: { ...headers, "Content-Type": "text/html; charset=utf-8" } });
    }
    if (fragment && !model.overview) return Response.json({ error: { code: "monitor_unavailable" } }, { status: 503, headers });
    if (fragment) return Response.json({ html: renderCompatibleContent(model), state: compatibleMonitorState(model) }, { headers });
    return new Response(renderCompatiblePage(model, getPublicConfig().appName), { headers: { ...headers, "Content-Type": "text/html; charset=utf-8" } });
  } catch {
    if (fragment) return Response.json({ error: { code: "monitor_unavailable" } }, { status: 503, headers });
    return new Response(renderCompatibleFailure("O monitoramento está temporariamente indisponível.", getPublicConfig().appName), { status: 503, headers: { ...headers, "Content-Type": "text/html; charset=utf-8" } });
  } finally {
    clearTimeout(timeout);
  }
}
