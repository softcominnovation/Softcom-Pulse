export type HealthResponse = {
  status: "ok" | "unavailable";
  checks: { database: "up" | "down"; cache: "up" | "down" };
};
