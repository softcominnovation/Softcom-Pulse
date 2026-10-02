import { getDatabase } from "@/lib/server/database";
import { pingCache } from "@/lib/server/cache";
import { checkDependencies } from "@/lib/server/health-result";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const result = await checkDependencies(() => getDatabase().query("SELECT 1"), pingCache);
  return Response.json(result, { status: result.status === "ok" ? 200 : 503, headers: { "Cache-Control": "no-store" } });
}
