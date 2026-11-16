/** 独立单实例调度进程：Web 应设置 DISABLE_CRON=1。 */
import { loadEnvConfig } from "@next/env";

async function main() {
  loadEnvConfig(process.cwd(), false);
  const [{ registerCronJobs, stopCronJobs }, { prisma }] = await Promise.all([
    import("./scheduler"), import("@/lib/prisma")
  ]);
  let stopping = false;
  const shutdown = async () => {
    if (stopping) return;
    stopping = true;
    const deadline = setTimeout(() => process.exit(1), 30_000);
    deadline.unref();
    try {
      await stopCronJobs();
      await prisma.$disconnect();
    } finally { clearTimeout(deadline); }
  };
  const onSignal = () => { void shutdown().catch(error => { console.error("[cron-worker] shutdown failed:", error); process.exitCode = 1; }); };
  process.once("SIGTERM", onSignal);
  process.once("SIGINT", onSignal);
  console.log("[cron-worker] starting LexOrder scheduler (single worker)");
  registerCronJobs();
}
main().catch(error => { console.error("[cron-worker] failed:", error); process.exitCode = 1; });
