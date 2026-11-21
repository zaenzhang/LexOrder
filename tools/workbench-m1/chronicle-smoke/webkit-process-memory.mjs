import { execFileSync } from "node:child_process";

const isMac = process.platform === "darwin";

export function processTable() {
  return execFileSync("ps", ["-eo", "pid=,ppid=,rss=,comm="], {
    encoding: "utf8", env: { ...process.env, COLUMNS: "250", LINES: "24" },
  }).trim().split("\n").map(line => {
    const [, pid, parent, rss, command] = /^\s*(\d+)\s+(\d+)\s+(\d+)\s+(.+)$/.exec(line);
    return { pid: Number(pid), parent: Number(parent), bytes: Number(rss) * 1024, command };
  });
}

export function processTree(rootPid, existingPids) {
  const processes = processTable();
  const children = new Map();
  for (const process of processes) {
    const siblings = children.get(process.parent) ?? [];
    siblings.push(process);
    children.set(process.parent, siblings);
  }
  const roots = isMac ? processes.filter(process => process.pid === rootPid) : (children.get(rootPid) ?? []);
  const descendants = [...roots];
  for (const { pid } of descendants) descendants.push(...(children.get(pid) ?? []));
  // WKWebView launches XPC services via launchd. In an isolated runner, include new
  // WebKit services that were absent before this test host started.
  const observed = new Set(descendants.map(process => process.pid));
  const xpc = isMac ? processes.filter(({ pid, command }) => !existingPids.has(pid) && !observed.has(pid)
    && /(?:^|\/)com\.apple\.WebKit\.(?:WebContent|Networking|GPU)(?:$|\s)/.test(command)) : [];
  const all = [...descendants, ...xpc];
  return { processes: all.length, xpcProcesses: xpc.length, bytes: all.reduce((total, process) => total + process.bytes, 0) };
}
