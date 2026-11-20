import { recoverStaleLeases, type JobScope } from "./queue";
import { processDueJobs } from "./worker";

const started = new Set<JobScope>();

export function startPersonalQueue(scope: Exclude<JobScope, "all">) {
  if (started.has(scope)) return;
  started.add(scope);
  let nextRecoveryAt = 0;

  async function tick() {
    let delay = 5_000;
    try {
      const now = Date.now();
      if (now >= nextRecoveryAt) {
        await recoverStaleLeases(scope);
        nextRecoveryAt = now + 60_000;
      }
      const result = await processDueJobs(1, scope);
      if (result.processed) delay = 500;
    } catch {
      console.error("[personal] 无法执行本地任务队列，下次轮询会重试。");
    }
    setTimeout(() => void tick(), delay).unref();
  }

  void tick();
}
