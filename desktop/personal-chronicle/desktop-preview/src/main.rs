#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use tauri::webview::{Cookie, NewWindowResponse};
use tauri::{Manager, Url, WebviewWindow, WebviewWindowBuilder};
use tauri_plugin_dialog::DialogExt;
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

fn permits_folder_picker(label: &str, page: &Url, configured: &Url, matter_id: &str) -> bool {
    label == "main"
        && configured.scheme() == "http"
        && configured.host_str() == Some("127.0.0.1")
        && configured.port().is_some()
        && page.origin() == configured.origin()
        && page.username().is_empty()
        && page.password().is_none()
        && matter_id.len() >= 25
        && matter_id.starts_with('c')
        && matter_id
            .bytes()
            .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit())
        && ["overview", "materials"].iter().any(|section| {
            page.path().trim_end_matches('/') == format!("/matters/{matter_id}/{section}")
        })
}

#[tauri::command]
async fn choose_case_directory(
    window: WebviewWindow,
    matter_id: String,
) -> Result<Option<String>, String> {
    let configured = window
        .config()
        .build
        .dev_url
        .clone()
        .ok_or("未配置桌面地址")?;
    let verify = || {
        let url = window.url().map_err(|_| "无法识别当前窗口")?;
        if permits_folder_picker(window.label(), &url, &configured, &matter_id) {
            Ok(())
        } else {
            Err("请从当前案件的概览或材料页选择文件夹")
        }
    };
    verify()?;
    let parent = window.clone();
    let selection = tauri::async_runtime::spawn_blocking(move || {
        parent
            .dialog()
            .file()
            .set_parent(&parent)
            .set_title("选择案件文件夹")
            .blocking_pick_folder()
    })
    .await
    .map_err(|_| "无法打开系统文件夹选择器")?;
    verify()?;
    selection
        .map(|selected| {
            selected
                .into_path()
                .map_err(|_| "请选择本机目录".to_string())?
                .into_os_string()
                .into_string()
                .map_err(|_| "目录路径无法表示为文本".to_string())
        })
        .transpose()
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![choose_case_directory])
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn picker_is_scoped_to_the_owning_case_in_the_main_local_webview() {
        let id = "caaaaaaaaaaaaaaaaaaaaaaaa";
        let origin = Url::parse("http://127.0.0.1:55313").unwrap();
        let materials = origin.join(&format!("/matters/{id}/materials")).unwrap();
        assert!(permits_folder_picker("main", &materials, &origin, id));
        assert!(permits_folder_picker(
            "main",
            &origin
                .join(&format!("/matters/{id}/overview/?q=x"))
                .unwrap(),
            &origin,
            id
        ));
        assert!(!permits_folder_picker("popup", &materials, &origin, id));
        assert!(!permits_folder_picker(
            "main",
            &materials,
            &origin,
            "cbbbbbbbbbbbbbbbbbbbbbbbb"
        ));
        assert!(!permits_folder_picker(
            "main",
            &origin.join("/matters/list").unwrap(),
            &origin,
            id
        ));
        assert!(!permits_folder_picker(
            "main",
            &materials,
            &Url::parse("http://127.0.0.1:55314").unwrap(),
            id
        ));
    }
}
