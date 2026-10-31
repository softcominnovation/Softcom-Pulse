import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { isPublicHost } from "@/lib/server/auth/public-hosts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const sounds = new Set(["notification", "warning", "error", "success"]);

export async function GET(request: Request, context: { params: Promise<{ sound: string }> }) {
  if (!isPublicHost(request)) return new Response(null, { status: 403, headers: { "Cache-Control": "no-store" } });
  const headers = { "Cache-Control": "no-store", "Access-Control-Allow-Origin": "*", "Referrer-Policy": "no-referrer", "X-Content-Type-Options": "nosniff" };
  const { sound } = await context.params;
  if (!sounds.has(sound)) return new Response(null, { status: 404, headers });
  try {
    const bytes = await readFile(join(process.cwd(), "public", "sounds", "notifications", sound + ".wav"));
    return new Response(new Uint8Array(bytes), { headers: { ...headers, "Content-Type": "audio/wav" } });
  } catch {
    return new Response(null, { status: 503, headers });
  }
}
