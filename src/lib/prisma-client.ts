import "dotenv/config";
import { Prisma, PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

/** Create an explicit connection; this application uses public-qualified SQL. */
export function createPrismaClient(databaseUrl: string | undefined, log: Prisma.LogLevel[] = []) {
  if (!databaseUrl) throw new Error("缺少 DATABASE_URL 数据库连接配置");
  const url = new URL(databaseUrl);
  const schema = url.searchParams.get("schema") ?? "public";
  if (schema !== "public") throw new Error("当前仅支持 public 数据库 schema");
  url.searchParams.delete("schema");
  const connectionLimit = url.searchParams.get("connection_limit");
  url.searchParams.delete("connection_limit");
  if (connectionLimit && (!/^\d+$/.test(connectionLimit) || Number(connectionLimit) < 1)) throw new Error("数据库连接数配置无效");
  const adapter = new PrismaPg({ connectionString: url.toString(), ...(connectionLimit ? { max: Number(connectionLimit) } : {}) }, { schema });
  return new PrismaClient({ adapter, log });
}
