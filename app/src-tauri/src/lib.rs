// Native shell. The whole app is TypeScript; the only custom native code is:
// - the OS credential store (Windows Credential Manager / macOS Keychain / Secret Service)
//   so API keys never land in plain-text config
// - `files.rs`: sandboxed file ops for the local instance manager
// - `memory.rs`: WebView2 memory target while minimized (not exposed by Tauri)
// - `process.rs`: runs side-by-side Meilisearch versions (the shell scope can't allow a
//   per-version path)

mod files;
mod memory;
mod process;

const SERVICE: &str = "io.meiliops.app";

#[tauri::command]
fn secret_set(account: String, secret: String) -> Result<(), String> {
    keyring::Entry::new(SERVICE, &account)
        .and_then(|e| e.set_password(&secret))
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn secret_get(account: String) -> Result<Option<String>, String> {
    match keyring::Entry::new(SERVICE, &account).and_then(|e| e.get_password()) {
        Ok(s) => Ok(Some(s)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

#[tauri::command]
fn secret_delete(account: String) -> Result<(), String> {
    match keyring::Entry::new(SERVICE, &account).and_then(|e| e.delete_credential()) {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(e.to_string()),
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default();
    #[cfg(desktop)]
    let builder = builder.plugin(tauri_plugin_updater::Builder::new().build()).plugin(tauri_plugin_process::init());
    builder
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_upload::init())
        .plugin(tauri_plugin_os::init())
        .plugin(tauri_plugin_http::init())
        .manage(process::Children::default())
        .invoke_handler(tauri::generate_handler![
            secret_set,
            secret_get,
            secret_delete,
            files::app_path_exists,
            files::app_ensure_dir,
            files::app_remove,
            files::app_replace_file,
            files::app_sha256,
            memory::webview_memory_low,
            process::meili_versions,
            process::meili_output,
            process::meili_spawn,
            process::meili_kill
        ])
        .run(tauri::generate_context!())
        .expect("error while running MeiliOps");
}
