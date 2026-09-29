// Runs installed Meilisearch versions for the local instance manager.
//
// Why not the shell plugin's JS API: its scope pins every allowed program to one fixed
// path (`cmd`), with no globs. Side-by-side versions live at
// `$APPLOCALDATA/bin/<version>/meilisearch[.exe]`, one path per version, so they can't be
// listed up front. These commands only ever run a binary from that layout (the version is
// validated, the path is built here) and reuse the shell plugin's Rust `Command`, which
// hides the console window on Windows. Docker and Podman still go through the JS API.
//
// On Windows every started instance joins a job object that kills it when MeiliOps exits for
// any reason (crash, Task Manager, the updater's installer, a `tauri dev` reload). Without it,
// an orphaned meilisearch.exe keeps its port and holds the data folder open, so the folder
// can't be deleted.

use std::{collections::HashMap, path::PathBuf, sync::Mutex};
use tauri::{ipc::Channel, AppHandle, Manager, Runtime, State};
use tauri_plugin_shell::{
    process::{CommandChild, CommandEvent},
    ShellExt,
};

#[derive(Default)]
pub struct Children(Mutex<HashMap<u32, CommandChild>>);

#[derive(Clone, serde::Serialize)]
#[serde(tag = "event", content = "data", rename_all = "lowercase")]
pub enum ProcEvent {
    Stdout(String),
    Stderr(String),
    Error(String),
    Close { code: Option<i32> },
}

#[derive(serde::Serialize)]
pub struct ProcOutput {
    code: Option<i32>,
    stdout: String,
    stderr: String,
}

const EXE: &str = if cfg!(windows) { "meilisearch.exe" } else { "meilisearch" };

fn bin_root<R: Runtime>(app: &AppHandle<R>) -> Result<PathBuf, String> {
    Ok(app.path().app_local_data_dir().map_err(|e| e.to_string())?.join("bin"))
}

/// `1.22.1`, `1.23.0-rc.1`: a single path segment, never `.` or `..`.
fn valid_version(v: &str) -> bool {
    !v.is_empty() && v.len() <= 64 && v.starts_with(|c: char| c.is_ascii_digit()) && v.chars().all(|c| c.is_ascii_alphanumeric() || c == '.' || c == '-')
}

fn binary<R: Runtime>(app: &AppHandle<R>, version: &str) -> Result<PathBuf, String> {
    if !valid_version(version) {
        return Err(format!("invalid version: {version}"));
    }
    let p = bin_root(app)?.join(version).join(EXE);
    if !p.is_file() {
        return Err(format!("Meilisearch {version} is not installed"));
    }
    Ok(p)
}

/// Installed versions (directories under `bin/` that contain a binary).
#[tauri::command]
pub fn meili_versions<R: Runtime>(app: AppHandle<R>) -> Result<Vec<String>, String> {
    let Ok(dir) = std::fs::read_dir(bin_root(&app)?) else { return Ok(vec![]) };
    Ok(dir
        .flatten()
        .filter_map(|e| e.file_name().into_string().ok())
        .filter(|v| valid_version(v) && bin_root(&app).map(|r| r.join(v).join(EXE).is_file()).unwrap_or(false))
        .collect())
}

/// Run a version to completion (`--version`, `--help`).
#[tauri::command]
pub async fn meili_output<R: Runtime>(app: AppHandle<R>, version: String, args: Vec<String>) -> Result<ProcOutput, String> {
    let out = app.shell().command(binary(&app, &version)?).args(args).output().await.map_err(|e| e.to_string())?;
    Ok(ProcOutput {
        code: out.status.code(),
        stdout: String::from_utf8_lossy(&out.stdout).into_owned(),
        stderr: String::from_utf8_lossy(&out.stderr).into_owned(),
    })
}

/// Start a version and stream its output. Returns the pid.
#[tauri::command]
pub fn meili_spawn<R: Runtime>(
    app: AppHandle<R>,
    children: State<'_, Children>,
    version: String,
    args: Vec<String>,
    cwd: String,
    env: HashMap<String, String>,
    on_event: Channel<ProcEvent>,
) -> Result<u32, String> {
    let cwd = crate::files::checked(&app, &cwd)?;
    let (mut rx, child) = app
        .shell()
        .command(binary(&app, &version)?)
        .args(args)
        .envs(env)
        .current_dir(cwd)
        .spawn()
        .map_err(|e| e.to_string())?;
    let pid = child.pid();
    #[cfg(windows)]
    if let Err(e) = kill_on_exit::assign(pid) {
        log_warn(&format!("pid {pid} not tied to the app's lifetime: {e}"));
    }
    children.0.lock().unwrap().insert(pid, child);
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        let text = |b: Vec<u8>| String::from_utf8_lossy(&b).into_owned();
        while let Some(ev) = rx.recv().await {
            let msg = match ev {
                CommandEvent::Stdout(b) => ProcEvent::Stdout(text(b)),
                CommandEvent::Stderr(b) => ProcEvent::Stderr(text(b)),
                CommandEvent::Error(e) => ProcEvent::Error(e),
                CommandEvent::Terminated(t) => {
                    app.state::<Children>().0.lock().unwrap().remove(&pid);
                    ProcEvent::Close { code: t.code }
                }
                _ => continue,
            };
            let _ = on_event.send(msg);
        }
    });
    Ok(pid)
}

#[tauri::command]
pub fn meili_kill(children: State<'_, Children>, pid: u32) -> Result<(), String> {
    match children.0.lock().unwrap().remove(&pid) {
        Some(child) => child.kill().map_err(|e| e.to_string()),
        None => Ok(()),
    }
}

#[cfg(windows)]
fn log_warn(msg: &str) {
    eprintln!("[process] {msg}");
}

#[cfg(windows)]
mod kill_on_exit {
    use std::sync::OnceLock;
    use windows::Win32::{
        Foundation::{CloseHandle, HANDLE},
        System::{
            JobObjects::{
                AssignProcessToJobObject, CreateJobObjectW, JobObjectExtendedLimitInformation, SetInformationJobObject,
                JOBOBJECT_EXTENDED_LIMIT_INFORMATION, JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
            },
            Threading::{OpenProcess, PROCESS_SET_QUOTA, PROCESS_TERMINATE},
        },
    };

    /// The job handle is never closed: the OS closes it when MeiliOps exits, which kills the job.
    struct Job(HANDLE);
    unsafe impl Send for Job {}
    unsafe impl Sync for Job {}

    fn job() -> Result<&'static Job, String> {
        static JOB: OnceLock<Result<Job, String>> = OnceLock::new();
        JOB.get_or_init(|| unsafe {
            let h = CreateJobObjectW(None, None).map_err(|e| e.to_string())?;
            let mut info = JOBOBJECT_EXTENDED_LIMIT_INFORMATION::default();
            info.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
            SetInformationJobObject(
                h,
                JobObjectExtendedLimitInformation,
                &info as *const _ as *const _,
                std::mem::size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
            )
            .map_err(|e| e.to_string())?;
            Ok(Job(h))
        })
        .as_ref()
        .map_err(Clone::clone)
    }

    pub fn assign(pid: u32) -> Result<(), String> {
        let job = job()?;
        unsafe {
            let process = OpenProcess(PROCESS_SET_QUOTA | PROCESS_TERMINATE, false, pid).map_err(|e| e.to_string())?;
            let res = AssignProcessToJobObject(job.0, process).map_err(|e| e.to_string());
            let _ = CloseHandle(process);
            res
        }
    }
}
