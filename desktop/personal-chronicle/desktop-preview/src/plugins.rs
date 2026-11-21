use std::{
    fs,
    io::{self, Read},
    path::Path,
};

use serde::{Deserialize, Serialize};
use tauri::{Manager, WebviewWindow};

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Manifest {
    api_version: u8,
    id: String,
    name: String,
    commands: Vec<Contribution>,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct Contribution {
    id: String,
    title: String,
    section: Section,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "kebab-case")]
enum Section {
    Overview,
    Materials,
    Court,
    Evidence,
    Research,
    Tasks,
    Delivery,
    Records,
    Finance,
    Seal,
    Archive,
}

fn identifier(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 64
        && value
            .bytes()
            .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || matches!(b, b'.' | b'-'))
        && value != "."
        && value != ".."
}

fn label(value: &str) -> bool {
    !value.trim().is_empty() && value.chars().count() <= 80 && !value.chars().any(char::is_control)
}

fn validate(id: &str, data: &[u8]) -> Option<Manifest> {
    let manifest: Manifest = serde_json::from_slice(data).ok()?;
    let mut seen = std::collections::HashSet::new();
    (manifest.api_version == 1
        && manifest.id == id
        && identifier(id)
        && label(&manifest.name)
        && (1..=16).contains(&manifest.commands.len())
        && manifest.commands.iter().all(|command| {
            identifier(&command.id) && label(&command.title) && seen.insert(&command.id)
        }))
    .then_some(manifest)
}

#[derive(Serialize)]
pub struct Catalog {
    plugins: Vec<Manifest>,
    invalid: Vec<String>,
}

fn scan(directory: &Path) -> io::Result<Catalog> {
    let mut catalog = Catalog {
        plugins: Vec::new(),
        invalid: Vec::new(),
    };
    let entries = match fs::read_dir(directory) {
        Ok(entries) => entries,
        Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(catalog),
        Err(error) => return Err(error),
    };
    for entry in entries {
        let entry = entry?;
        let id = entry.file_name();
        let Some(id) = id.to_str().filter(|value| identifier(value)) else {
            continue;
        };
        if !entry.file_type()?.is_dir() {
            continue;
        }
        let path = entry.path().join("manifest.json");
        let parsed = (|| {
            if !fs::symlink_metadata(&path).ok()?.is_file() {
                return None;
            }
            let mut buffer = Vec::new();
            fs::File::open(&path)
                .ok()?
                .take(32_769)
                .read_to_end(&mut buffer)
                .ok()?;
            if buffer.len() > 32_768 {
                return None;
            }
            validate(id, &buffer)
        })();
        if let Some(manifest) = parsed {
            catalog.plugins.push(manifest);
        } else {
            catalog.invalid.push(id.to_owned());
        }
    }
    catalog
        .plugins
        .sort_by(|left, right| left.id.cmp(&right.id));
    catalog.invalid.sort();
    Ok(catalog)
}

#[tauri::command]
pub async fn read_desktop_plugins(window: WebviewWindow) -> Result<Catalog, String> {
    let origin = super::trusted_origin(window.app_handle()).ok_or("个人工作区尚未就绪。")?;
    if window.label() != "main"
        || window.url().map_err(|_| "无法识别窗口")?.origin() != origin.origin()
    {
        return Err("请从工作台打开插件。".into());
    }
    let plugins = window
        .path()
        .app_local_data_dir()
        .map_err(|_| "无法定位本机插件目录")?
        .join("plugins");
    tauri::async_runtime::spawn_blocking(move || scan(&plugins))
        .await
        .map_err(|_| "无法读取本机插件")?
        .map_err(|_| "无法读取本机插件".into())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn validates_manifest_version_identity_and_contributions() {
        let input = r#"{"apiVersion":1,"id":"case.tools","name":"Case tools","commands":[{"id":"review","title":"Review","section":"materials"}]}"#;
        assert!(validate("case.tools", input.as_bytes()).is_some());
        assert!(validate("other", input.as_bytes()).is_none());
        assert!(
            validate(
                "case.tools",
                input
                    .replace("materials", "https://example.org/")
                    .as_bytes()
            )
            .is_none()
        );
        assert!(
            validate(
                "case.tools",
                input.replace("apiVersion\":1", "apiVersion\":2").as_bytes()
            )
            .is_none()
        );
        assert!(
            validate(
                "case.tools",
                input
                    .replace(r#""materials""#, r#""materials","exec":"anything""#)
                    .as_bytes()
            )
            .is_none()
        );
    }
}
