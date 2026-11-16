/** 已有实例增补缺失的内置文书；不重跑其他 seed 配置，不覆盖已有模板。 */
import { loadEnvConfig } from "@next/env";

async function main() {
  loadEnvConfig(process.cwd(), false);
  const [{ createPrismaClient }, { seedV08Templates }] = await Promise.all([
    import("../src/lib/prisma-client"), import("../prisma/seeds/v08-templates-and-seals")
  ]);
  const prisma = createPrismaClient(process.env.DATABASE_URL);
  try {
    if (!await prisma.user.findFirst({ where: { systemRole: "SUPER_ADMIN", active: true }, select: { id: true } })) {
      throw new Error("请先完成首次初始化，建立有效的系统管理员");
    }
    await seedV08Templates(prisma);
  } finally { await prisma.$disconnect(); }
}
main().catch(error => { console.error("[lexorder-templates] 同步失败：", error); process.exitCode = 1; });
