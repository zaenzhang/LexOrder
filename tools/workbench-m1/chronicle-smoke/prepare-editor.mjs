import { mkdir, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import path from "node:path";
if (process.platform !== "linux" || !process.env.M1_WORKSPACE)
  throw Error("Set M1_WORKSPACE on a Linux acceptance host.");
execFileSync("ex", ["--version"]);
const base = path.resolve(process.env.M1_WORKSPACE, "smoke-editor");
const applications = path.join(base, "data", "applications");
await mkdir(applications, { recursive: true, mode: 0o700 });
await mkdir(path.join(base, "config"), { recursive: true, mode: 0o700 });
const runner = path.join(base, "edit");
await writeFile(
  runner,
  "#!/bin/sh\nexec ex -Nu NONE -n -es \"$1\" <<'VIM'\nnormal! GoLinux default editor saved\nwq\nVIM\n",
  { mode: 0o700 },
);
const executable = '"' + runner.replace(/([\\"$`])/g, "\\$1").replaceAll("%", "%%") + '"';
await writeFile(
  path.join(applications, "lexorder-smoke.desktop"),
  [
    "[Desktop Entry]",
    "Type=Application",
    "Name=LexOrder synthetic acceptance editor",
    "Exec=" + executable + " %f",
    "Terminal=false",
    "MimeType=text/plain;",
    "NoDisplay=true",
    "",
  ].join("\n"),
);
await writeFile(
  path.join(base, "config", "mimeapps.list"),
  "[Default Applications]\ntext/plain=lexorder-smoke.desktop\n",
);
execFileSync("update-desktop-database", [applications]);
console.log("Prepared isolated XDG default editor");
