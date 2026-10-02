import type { HealthResponse } from "@/lib/health";

export async function checkDependencies(database: () => Promise<unknown>, cache: () => Promise<unknown>): Promise<HealthResponse> {
  const checks = await Promise.allSettled([Promise.resolve().then(database), Promise.resolve().then(cache)]);
  const result = { database: checks[0].status === "fulfilled" ? "up" as const : "down" as const, cache: checks[1].status === "fulfilled" ? "up" as const : "down" as const };
  return { status: result.database === "up" && result.cache === "up" ? "ok" : "unavailable", checks: result };
}
