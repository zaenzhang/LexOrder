import type { PrismaClient } from "@prisma/client";
import { createPrismaClient } from "./prisma-client";

const globalForPrisma = globalThis as unknown as { prisma: PrismaClient | undefined };
let localClient: PrismaClient | undefined;
function getClient(): PrismaClient {
  if (!localClient) {
    localClient = globalForPrisma.prisma ?? createPrismaClient(process.env.DATABASE_URL, ["warn"]);
    if (process.env.NODE_ENV !== "production" || process.env.LEXORDER_RUNTIME_MODE === "PERSONAL") globalForPrisma.prisma = localClient;
  }
  return localClient;
}

// Next can import server modules at build time without a database connection.
export const prisma = new Proxy({} as PrismaClient, {
  get(_target, key) {
    const client = getClient();
    const value = Reflect.get(client, key, client);
    return typeof value === "function" ? value.bind(client) : value;
  },
});
