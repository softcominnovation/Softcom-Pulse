import "server-only";
import { Pool } from "pg";

const globalDatabase = globalThis as unknown as { pulseDatabase?: Pool };

export function getDatabase() {
  if (!process.env.DATABASE_URL) throw new Error("Database configuration is missing.");
  if (!globalDatabase.pulseDatabase) {
    const pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      max: 5,
      connectionTimeoutMillis: 2000,
      idleTimeoutMillis: 10000,
      query_timeout: 2000,
      statement_timeout: 2000,
    });
    pool.on("error", () => {});
    globalDatabase.pulseDatabase = pool;
  }
  return globalDatabase.pulseDatabase;
}
