#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use tauri::webview::{Cookie, NewWindowResponse};
use tauri::{Url, WebviewWindowBuilder};
use tauri_plugin_opener::OpenerExt;

fn open_external(app: &tauri::AppHandle, url: &Url) {
    if matches!(url.scheme(), "https" | "http")
        && url.host_str().is_some_and(|host| {
            !matches!(host, "localhost" | "tauri.localhost")
                && !host.ends_with(".localhost")
                && !host
                    .trim_matches(['[', ']'])
                    .parse::<std::net::IpAddr>()
                    .is_ok_and(|ip| ip.is_loopback())
        })
        && url.username().is_empty()
        && url.password().is_none()
    {
        if app.opener().open_url(url.as_str(), None::<&str>).is_err() {
            eprintln!("Could not open external HTTP link");
        }
    }
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let origin = app.config().build.dev_url.as_ref().ok_or("missing preview URL")?.origin();
            let navigation_app = app.handle().clone();
            let popup_app = navigation_app.clone();
            let popup_origin = origin.clone();
            let window = WebviewWindowBuilder::from_config(app, &app.config().app.windows[0])?
                .zoom_hotkeys_enabled(cfg!(debug_assertions))
                .on_navigation(move |url| {
                    if url.origin() == origin {
                        return true;
                    }
                    open_external(&navigation_app, url);
                    false
                })
                .on_new_window(move |url, _| {
                    if url.origin() == popup_origin {
                        return NewWindowResponse::Allow;
                    }
                    open_external(&popup_app, &url);
                    NewWindowResponse::Deny
                })
                .build()?;

            if let Ok(token) = std::env::var("LEXORDER_PERSONAL_CHANNEL_TOKEN") {
                if token.len() != 64
                    || !token.bytes().all(|c| c.is_ascii_digit() || (b'a'..=b'f').contains(&c))
                {
                    return Err("invalid personal workspace channel".into());
                }
                let cookie = Cookie::parse(format!(
                    "lexorder_local_channel={token}; Domain=127.0.0.1; Path=/api/personal-runtime; HttpOnly; SameSite=Strict"
                ))?;
                window.set_cookie(cookie)?;
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("open the Chronicle local desktop preview");
}
