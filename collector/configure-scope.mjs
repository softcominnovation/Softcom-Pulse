import { readFile } from "node:fs/promises";
import { z } from "zod";
import { hostKeySchema } from "../lib/config/resources.ts";
import { monitoringScopeSchema } from "../lib/server/zabbix/scope.ts";
import { getPrisma } from "../lib/server/prisma.ts";
import { getDatabase } from "../lib/server/database.ts";

const schema = z.strictObject({ asgardHostKey: hostKeySchema, scope: monitoringScopeSchema }).refine(value => value.scope.hostKeys.includes(value.asgardHostKey));
try {
  if (process.argv.length !== 3) throw new Error();
  const content = await readFile(process.argv[2], "utf8");
  if (Buffer.byteLength(content) > 65536) throw new Error();
  const config = schema.parse(JSON.parse(content));
  await getPrisma().$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(734021003::bigint)`;
    for (const [key, value] of [["asgardHostKey", config.asgardHostKey], ["monitoringScope", config.scope]]) await tx.pulseSetting.upsert({ where: { key }, create: { key, value }, update: { value } });
  });
  console.log("Monitoring scope saved. It will apply to the next collection cycle.");
} catch {
  console.error("Could not save monitoring scope. Provide one valid JSON file and check the database configuration.");
  process.exitCode = 1;
} finally {
  if (process.env.DATABASE_URL) { await getPrisma().$disconnect(); await getDatabase().end(); }
}
