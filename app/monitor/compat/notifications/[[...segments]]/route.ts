import { publicResponse } from "@/lib/server/bff";
import { readNotificationRoute } from "@/lib/server/notifications/handlers";
import { compatibleNotificationPayload } from "@/lib/server/monitor-compat/notifications";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Anonymous, read-only adapter of the current notification contracts, including history/usage. */
export async function GET(request: Request, context: { params: Promise<{ segments?: string[] }> }) {
  return publicResponse(request, async () => compatibleNotificationPayload(
    await readNotificationRoute(request, (await context.params).segments ?? [], "public"),
  ));
}
