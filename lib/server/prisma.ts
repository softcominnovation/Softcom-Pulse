import "server-only";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../../generated/prisma/client.ts";
import { getDatabase } from "./database.ts";

const globalPrisma = globalThis as unknown as { pulsePrisma?: PrismaClient };

export function getPrisma() {
  globalPrisma.pulsePrisma ??= new PrismaClient({ adapter: new PrismaPg(getDatabase()) });
  return globalPrisma.pulsePrisma;
}
