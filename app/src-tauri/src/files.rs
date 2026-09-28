// File operations for the local instance manager (binary install, data dirs).
//
// Why not tauri-plugin-fs: on Windows its scope check canonicalizes existing
// paths to the `\\?\C:\…` verbatim form, which never matches the `$APPLOCALDATA/**`
// pattern — so every *existing* file is reported as "forbidden". These commands are
// restricted to the app's local data dir instead.

use sha2::{Digest, Sha256};
use std::{
    fs,
    io::Read,
    path::{Component, PathBuf},
};
use tauri::{AppHandle, Manager, Runtime};

/// Resolve `path` and make sure it lives inside the app's local data dir.
fn checked<R: Runtime>(app: &AppHandle<R>, path: &str) -> Result<PathBuf, String> {
    let root = app.path().app_local_data_dir().map_err(|e| e.to_string())?;
    let p = PathBuf::from(path);
    if !p.is_absolute() || p.components().any(|c| matches!(c, Component::ParentDir)) || !p.starts_with(&root) {
        return Err(format!("path is outside the app data directory: {path}"));
    }
    Ok(p)
}

#[tauri::command]
pub fn app_path_exists<R: Runtime>(app: AppHandle<R>, path: String) -> Result<bool, String> {
    Ok(checked(&app, &path)?.exists())
}

#[tauri::command]
pub fn app_ensure_dir<R: Runtime>(app: AppHandle<R>, path: String) -> Result<(), String> {
    fs::create_dir_all(checked(&app, &path)?).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn app_remove<R: Runtime>(app: AppHandle<R>, path: String) -> Result<(), String> {
    let p = checked(&app, &path)?;
    let res = if p.is_dir() { fs::remove_dir_all(&p) } else if p.exists() { fs::remove_file(&p) } else { Ok(()) };
    res.map_err(|e| e.to_string())
}

/// Atomically move `from` over `to` (used to swap in a freshly verified binary).
#[tauri::command]
pub fn app_replace_file<R: Runtime>(app: AppHandle<R>, from: String, to: String) -> Result<(), String> {
    let (from, to) = (checked(&app, &from)?, checked(&app, &to)?);
    if to.exists() {
        fs::remove_file(&to).map_err(|e| e.to_string())?;
    }
    fs::rename(&from, &to).map_err(|e| e.to_string())?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(&to, fs::Permissions::from_mode(0o755)).map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Streaming SHA-256 (hex), computed natively on a worker thread.
#[tauri::command]
pub async fn app_sha256<R: Runtime>(app: AppHandle<R>, path: String) -> Result<String, String> {
    let p = checked(&app, &path)?;
    tauri::async_runtime::spawn_blocking(move || {
        let mut file = fs::File::open(&p).map_err(|e| e.to_string())?;
        let mut hasher = Sha256::new();
        let mut buf = vec![0u8; 1 << 20];
        loop {
            let n = file.read(&mut buf).map_err(|e| e.to_string())?;
            if n == 0 {
                break;
            }
            hasher.update(&buf[..n]);
        }
        Ok(hasher.finalize().iter().map(|b| format!("{b:02x}")).collect())
    })
    .await
    .map_err(|e| e.to_string())?
}
