/** 独立备份入口：npm run backup:now；加载本项目 .env，可由宿主定时器调用。 */
import { loadEnvConfig } from "@next/env";

async function main() {
  loadEnvConfig(process.cwd(), false);
  const [{ runDatabaseBackupNow }, { prisma }, { audit }] = await Promise.all([
    import("../src/server/cron/jobs/backup-database"), import("../src/lib/prisma"), import("../src/server/audit")
  ]);
  try {
    const result = await runDatabaseBackupNow();
    if (!result.ok) throw new Error(result.error ?? "备份未完成");
    console.log(`[lexorder-backup] 完成，清理旧备份 ${result.removedOld ?? 0} 份`);
  } catch (error) {
    process.exitCode = 1;
    const message = error instanceof Error ? error.message : String(error);
    console.error("[lexorder-backup] 失败：", message);
    await audit({ userId: null, action: "DATABASE_BACKUP_FAILED_CRON", targetType: "Cron", targetId: "database-backup-cli", detail: { error: message.slice(0, 500) } });
  } finally { await prisma.$disconnect(); }
}
main().catch(error => { console.error("[lexorder-backup] 执行异常：", error); process.exitCode = 1; });
