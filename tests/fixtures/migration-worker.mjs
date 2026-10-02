import { withMigrationLock } from "../../docker/migration-lock.mjs";
import { runMigrationProcess } from "../../docker/migrate.mjs";
import { setTimeout as delay } from "node:timers/promises";
try {
  await withMigrationLock({
    connectionString: process.env.DATABASE_URL,
    waitMs: 15000,
    execute: async signal => {
      process.send?.({ type: "start", at: Date.now() });
      await runMigrationProcess(signal);
      await delay(300, undefined, { signal });
      process.send?.({ type: "end", at: Date.now() });
    },
  });
  process.disconnect?.();
} catch {
  process.send?.({ type: "failed" });
  process.disconnect?.();
  process.exitCode = 1;
}
