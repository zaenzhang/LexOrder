/**
 * Next.js instrumentation hook：进程启动时一次性副作用注册。
 *
 * 按运行模式启动团队调度或个人材料队列（仅生产 / Node.js）。
 * dev 模式跳过，避免开发时误推真实通知。
 *
 * Node.js 运行时内动态加载调度器，让生产构建包含依赖并隔离 Edge 运行时。
 */
export async function register() {
  // Keep the dynamic import inside the literal runtime branch so Next also
  // removes Node-only job dependencies from the Edge instrumentation bundle.
  if (process.env.NEXT_RUNTIME === "nodejs") {
    if (process.env.NODE_ENV !== "production") return;
    const { isPersonalMode } = await import("./lib/runtime/mode");
    if (isPersonalMode()) {
      const { startPersonalQueue } = await import("./server/cron/personal-material-worker");
      startPersonalQueue("personal-materials");
      startPersonalQueue("personal-ai");
      return;
    }
    if (process.env.DISABLE_CRON === "1") return;
    const { registerCronJobs } = await import("./server/cron/scheduler");
    registerCronJobs();
  }
}
