fn main() {
    let manifest = tauri_build::AppManifest::new().commands(&["choose_case_directory"]);
    tauri_build::try_build(tauri_build::Attributes::new().app_manifest(manifest))
        .expect("build the Chronicle desktop host");
}
