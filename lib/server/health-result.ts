import type { HealthResponse } from "@/lib/health";
import { logRequestFailure } from "./diagnostics.ts";

export async function checkDependencies(database: () => Promise<unknown>, cache: () => Promise<unknown>, request?: Request): Promise<HealthResponse> {
  const checks = await Promise.allSettled([Promise.resolve().then(database), Promise.resolve().then(cache)]);
  checks.forEach((check, index) => {
    if (check.status === "rejected") logRequestFailure({ request, path: "/api/health", method: "GET", status: 503, code: index === 0 ? "database_unavailable" : "cache_unavailable", error: check.reason });
  });
  const result = { database: checks[0].status === "fulfilled" ? "up" as const : "down" as const, cache: checks[1].status === "fulfilled" ? "up" as const : "down" as const };
  return { status: result.database === "up" && result.cache === "up" ? "ok" : "unavailable", checks: result };
}
