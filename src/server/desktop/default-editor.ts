import { platform } from "node:os";
import { spawn } from "node:child_process";
import { ActionError } from "@/lib/action-error";

// Launchers need the user's desktop session and file associations. Give them
// system paths and locale explicitly: the Personal runtime also has private
// database, storage and channel credentials in its environment.
const desktopVariables = new Set([
  "PATH", "HOME", "USER", "LOGNAME", "SHELL", "LANG", "LANGUAGE", "TZ", "TMPDIR", "TEMP", "TMP",
  "LC_ALL", "LC_CTYPE", "LC_MESSAGES", "LC_TIME", "LC_COLLATE", "LC_MONETARY", "LC_NUMERIC",
  "DISPLAY", "WAYLAND_DISPLAY", "XAUTHORITY", "DBUS_SESSION_BUS_ADDRESS", "DESKTOP_SESSION",
  "XDG_RUNTIME_DIR", "XDG_CURRENT_DESKTOP", "XDG_SESSION_TYPE", "XDG_SESSION_DESKTOP",
  "XDG_DATA_HOME", "XDG_CONFIG_HOME", "XDG_DATA_DIRS", "XDG_CONFIG_DIRS", "XDG_CACHE_HOME",
  "SYSTEMROOT", "SYSTEMDRIVE", "WINDIR", "COMSPEC", "PATHEXT", "USERPROFILE", "USERNAME",
  "HOMEDRIVE", "HOMEPATH", "APPDATA", "LOCALAPPDATA", "PROGRAMDATA", "PROGRAMFILES",
  "PROGRAMFILES(X86)", "PROGRAMW6432", "PUBLIC", "__CF_USER_TEXT_ENCODING",
]);

/** The caller supplies a verified, app-issued working file, never a client path. */
export async function openDefaultEditor(file: string) {
  const windows = platform() === "win32";
  const command = windows ? "powershell.exe" : platform() === "darwin" ? "open" : "xdg-open";
  const args = windows ? ["-NoProfile", "-NonInteractive", "-Command",
    "Start-Process -FilePath $env:LEXORDER_OPEN_WORKING_COPY -ErrorAction Stop"] : [file];
  // Next augments ProcessEnv with NODE_ENV for its own server. The child does
  // not run Next and starts with an empty environment dictionary.
  const env = Object.create(null) as NodeJS.ProcessEnv;
  for (const [name, value] of Object.entries(process.env)) {
    if (desktopVariables.has(windows ? name.toUpperCase() : name)) env[name] = value;
  }
  if (windows) env.LEXORDER_OPEN_WORKING_COPY = file;
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, { shell: false, windowsHide: true, stdio: "ignore",
      env });
    // PowerShell exits when Start-Process hands the file to its association.
    // xdg-open may stay attached until the editor closes.
    const started = windows ? undefined : setTimeout(() => { child.unref(); resolve(); }, 1500);
    const failed = () => reject(new ActionError("系统未能打开工作稿，请检查该文件类型的默认编辑器。"));
    child.once("error", () => { clearTimeout(started); failed(); });
    child.once("exit", code => { clearTimeout(started); if (code === 0) resolve(); else failed(); });
  });
}
