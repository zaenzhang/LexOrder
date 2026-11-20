use std::{
    fmt::Write,
    path::PathBuf,
    sync::{Mutex, OnceLock},
    time::Duration,
};

use tauri::{AppHandle, Manager, Url};
use tauri_plugin_shell::{
    ShellExt,
    process::{CommandChild, CommandEvent},
};

const READY_PREFIX: &str = "LEXORDER_READY ";
const STARTUP_TIMEOUT: Duration = Duration::from_secs(240);

pub struct Session {
    pub origin: OnceLock<Url>,
    pub token: String,
    process: Mutex<Process>,
}

struct Process {
    child: Option<CommandChild>,
    stopping: bool,
    window_failed: bool,
}

pub fn start(app: &AppHandle, root: PathBuf) -> Result<(), Box<dyn std::error::Error>> {
    let workspace = match std::env::var_os("LEXORDER_DESKTOP_WORKSPACE") {
        Some(path) => PathBuf::from(path),
        None => app.path().app_local_data_dir()?.join("workspace"),
    };
    if !root.is_absolute() || !workspace.is_absolute() {
        return Err("desktop source and workspace paths must be absolute".into());
    }
    let script = root.join("tools/workbench-m1/personal-runtime.mjs");
    let mut random = [0_u8; 32];
    getrandom::fill(&mut random).map_err(|_| "could not create the desktop channel")?;
    let mut token = String::with_capacity(random.len() * 2);
    for byte in random {
        write!(token, "{byte:02x}")?;
    }
    let (mut events, child) = app
        .shell()
        .sidecar("lexorder-bun")?
        .args(["--no-env-file", "--no-install"])
        .arg(script.as_os_str())
        .arg("--desktop")
        .current_dir(root)
        .env("M1_WORKSPACE", workspace.as_os_str())
        .env("LEXORDER_DESKTOP_TOKEN", &token)
        .set_process_group(true)
        .spawn()?;
    app.manage(Session {
        origin: OnceLock::new(),
        token,
        process: Mutex::new(Process {
            child: Some(child),
            stopping: false,
            window_failed: false,
        }),
    });

    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        let mut ended = false;
        let startup = tokio::time::timeout(STARTUP_TIMEOUT, async {
            while let Some(event) = events.recv().await {
                match event {
                    CommandEvent::Stdout(line) => {
                        if let Some(origin) = ready_origin(&line) {
                            return Ok(origin);
                        }
                    }
                    CommandEvent::Terminated(exit) => {
                        ended = true;
                        return Err(format!("runtime exited before readiness ({:?})", exit.code));
                    }
                    event => log_diagnostic(event),
                }
            }
            Err("runtime event channel closed before readiness".into())
        })
        .await
        .unwrap_or_else(|_| Err("runtime did not become ready in four minutes".into()));

        let mut failed = startup.is_err();
        match startup {
            Ok(origin) => {
                let handle = app.clone();
                if app
                    .run_on_main_thread(move || {
                        let session = handle.state::<Session>();
                        if session.process.lock().unwrap().stopping {
                            return;
                        }
                        session.origin.set(origin.clone()).unwrap();
                        if let Err(error) = super::open_main(&handle, origin.clone()) {
                            eprintln!("Chronicle could not open: {error}");
                            session.process.lock().unwrap().window_failed = true;
                            stop(&handle);
                        } else {
                            println!("LEXORDER_DESKTOP_READY {origin}");
                        }
                    })
                    .is_err()
                {
                    failed = true;
                    stop(&app);
                }
            }
            Err(error) => {
                eprintln!("Chronicle startup: {error}");
                if !ended {
                    stop(&app);
                }
            }
        }

        while !ended && let Some(event) = events.recv().await {
            if let CommandEvent::Terminated(exit) = event {
                failed |= exit.code != Some(0);
                break;
            }
            log_diagnostic(event);
        }
        let session = app.state::<Session>();
        let mut process = session.process.lock().unwrap();
        process.child.take();
        let clean = !failed && !process.window_failed && process.stopping;
        drop(process);
        app.exit(if clean { 0 } else { 1 });
    });
    Ok(())
}

pub fn stop(app: &AppHandle) -> bool {
    let Some(session) = app.try_state::<Session>() else {
        return false;
    };
    let mut process = session.process.lock().unwrap();
    if process.child.is_none() {
        return false;
    }
    if process.stopping {
        return true;
    }
    process.stopping = true;
    if let Some(child) = &mut process.child
        && let Err(error) = child.write(b"quit\n")
    {
        eprintln!("Chronicle could not signal the runtime: {error}");
    }

    // During initial provisioning, let Prisma complete before releasing the workspace.
    let timeout = if session.origin.get().is_some() {
        Duration::from_secs(40)
    } else {
        STARTUP_TIMEOUT
    };
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(timeout).await;
        let session = app.state::<Session>();
        let child = session.process.lock().unwrap().child.take();
        if let Some(child) = child {
            eprintln!("Chronicle runtime did not stop in time. Ending its process group.");
            if let Err(error) = child.kill() {
                eprintln!("Chronicle could not end its runtime: {error}");
            }
            app.exit(1);
        }
    });
    true
}

fn ready_origin(line: &[u8]) -> Option<Url> {
    let value = std::str::from_utf8(line)
        .ok()?
        .trim_end()
        .strip_prefix(READY_PREFIX)?;
    let origin = Url::parse(value).ok()?;
    if origin.scheme() == "http"
        && origin.host_str() == Some("127.0.0.1")
        && origin.port().is_some()
        && origin.origin().ascii_serialization() == value
    {
        Some(origin)
    } else {
        None
    }
}

fn log_diagnostic(event: CommandEvent) {
    match event {
        CommandEvent::Error(error) => eprintln!("Chronicle runtime event: {error}"),
        CommandEvent::Stderr(line) if cfg!(debug_assertions) => {
            eprintln!("{}", String::from_utf8_lossy(&line).trim_end());
        }
        _ => {}
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_only_the_reserved_loopback_origin() {
        assert!(ready_origin(b"LEXORDER_READY http://127.0.0.1:49152\r\n").is_some());
        for invalid in [
            "READY http://127.0.0.1:49152",
            "LEXORDER_READY https://127.0.0.1:49152",
            "LEXORDER_READY http://127.0.0.1",
            "LEXORDER_READY http://127.0.0.1:49152/path",
            "LEXORDER_READY http://127.0.0.1:49152/?token=abc",
            "LEXORDER_READY http://other@127.0.0.1:49152",
            "LEXORDER_READY http://localhost:49152",
            "LEXORDER_READY http://192.168.1.2:49152",
        ] {
            assert!(ready_origin(invalid.as_bytes()).is_none(), "{invalid}");
        }
    }
}
