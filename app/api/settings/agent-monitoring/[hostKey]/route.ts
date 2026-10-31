import { protectedResponse, queryParams, jsonBody } from "@/lib/server/bff";
import { z } from "zod";
import { BffError } from "@/lib/server/bff";
import { readAgentMonitoring, saveAgentMonitoring } from "@/lib/server/config/agent-monitoring";

type Context = { params: Promise<{ hostKey: string }> };
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export function GET(request: Request, context: Context) {
  return protectedResponse(request, async editor => {
    if (!editor) throw new BffError(403, "editor_required");
    queryParams(request, z.strictObject({}));
    return { data: await readAgentMonitoring((await context.params).hostKey) };
  });
}
export function PUT(request: Request, context: Context) {
  return protectedResponse(request, async () => {
    queryParams(request, z.strictObject({}));
    return { data: await saveAgentMonitoring((await context.params).hostKey, await jsonBody(request)) };
  });
}
