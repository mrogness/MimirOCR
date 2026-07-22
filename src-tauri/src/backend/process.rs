use std::fs;
use std::fs::OpenOptions;
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::thread;
use std::time::Duration;

#[cfg(unix)]
use std::os::unix::process::CommandExt;

use tauri::Manager;

use super::state::{BackendRuntimePaths, BackendState};

pub fn backend_runtime_paths(app: &tauri::App, project_root: &PathBuf) -> BackendRuntimePaths {
    let backend_default_data = project_root.join("backend").join("data");
    let backend_default_cache = project_root.join("backend").join("output");
    let backend_default_temp = project_root.join("backend").join("tmp");

    let app_data_dir = app
        .path()
        .app_data_dir()
        .unwrap_or(backend_default_data)
        .join("backend");
    let cache_dir = app
        .path()
        .app_cache_dir()
        .unwrap_or(backend_default_cache)
        .join("backend");
    let temp_dir = app
        .path()
        .temp_dir()
        .unwrap_or(backend_default_temp)
        .join("backend");

    for path in [&app_data_dir, &cache_dir, &temp_dir] {
        if let Err(err) = fs::create_dir_all(path) {
            eprintln!("Failed to create backend runtime directory {}: {err}", path.display());
        }
    }

    BackendRuntimePaths {
        app_data_dir,
        cache_dir,
        temp_dir,
    }
}

pub fn try_spawn_backend_sidecar(
    path: &PathBuf,
    port: u16,
    runtime_paths: &BackendRuntimePaths,
    sidecar_log_path: &PathBuf,
) -> std::io::Result<Child> {
    let parent_pid = std::process::id().to_string();

    if let Some(parent_dir) = sidecar_log_path.parent() {
        fs::create_dir_all(parent_dir)?;
    }

    let log_file = OpenOptions::new()
        .create(true)
        .write(true)
        .truncate(true)
        .open(sidecar_log_path)?;
    let log_file_err = log_file.try_clone()?;

    let mut cmd = Command::new(path);
    cmd.arg("--host")
        .arg("127.0.0.1")
        .arg("--port")
        .arg(port.to_string())
        .env("MIMIR_PARENT_PID", &parent_pid)
        .env("MIMIR_APP_DATA_DIR", &runtime_paths.app_data_dir)
        .env("MIMIR_CACHE_DIR", &runtime_paths.cache_dir)
        .env("MIMIR_TEMP_DIR", &runtime_paths.temp_dir)
        .env("MIMIR_SIDECAR_LOG_PATH", sidecar_log_path)
        .stdin(Stdio::null())
        .stdout(Stdio::from(log_file))
        .stderr(Stdio::from(log_file_err));

    #[cfg(unix)]
    {
        cmd.process_group(0);
    }

    cmd.spawn()
}

pub fn try_spawn_backend(
    python_bin: &str,
    project_root: &PathBuf,
    port: u16,
    with_reload: bool,
    runtime_paths: &BackendRuntimePaths,
) -> std::io::Result<Child> {
    let parent_pid = std::process::id().to_string();
    let mut cmd = Command::new(python_bin);
    cmd.arg("-m")
        .arg("uvicorn")
        .arg("backend.main:app")
        .arg("--host")
        .arg("127.0.0.1")
        .arg("--port")
        .arg(port.to_string())
        .env("MIMIR_PARENT_PID", &parent_pid)
        .env("MIMIR_APP_DATA_DIR", &runtime_paths.app_data_dir)
        .env("MIMIR_CACHE_DIR", &runtime_paths.cache_dir)
        .env("MIMIR_TEMP_DIR", &runtime_paths.temp_dir)
        .current_dir(project_root)
        .stdin(Stdio::null());

    if with_reload {
        let reload_dir = project_root.join("backend");
        cmd.arg("--reload").arg("--reload-dir").arg(reload_dir);
        cmd.stdout(Stdio::inherit()).stderr(Stdio::inherit());
    } else {
        cmd.stdout(Stdio::null()).stderr(Stdio::null());
    }

    #[cfg(unix)]
    {
        cmd.process_group(0);
    }

    cmd.spawn()
}

pub fn ensure_child_is_running(mut child: Child, context: &str) -> std::io::Result<Child> {
    thread::sleep(Duration::from_millis(500));
    match child.try_wait()? {
        Some(status) => Err(std::io::Error::new(
            std::io::ErrorKind::Other,
            format!("{context} exited early with status {status}"),
        )),
        None => Ok(child),
    }
}

fn terminate_child_process(child: &mut Child) {
    #[cfg(target_os = "windows")]
    {
        let pid = child.id().to_string();
        let _ = Command::new("taskkill")
            .args(["/PID", &pid, "/T", "/F"])
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status();
    }

    #[cfg(not(target_os = "windows"))]
    {
        let pid = child.id();
        let pgid = format!("-{pid}");

        let _ = Command::new("kill")
            .args(["-TERM", &pgid])
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status();

        thread::sleep(Duration::from_millis(250));

        if matches!(child.try_wait(), Ok(None)) {
            let _ = Command::new("kill")
                .args(["-KILL", &pgid])
                .stdin(Stdio::null())
                .stdout(Stdio::null())
                .stderr(Stdio::null())
                .status();

            let _ = child.kill();
        }
    }

    let _ = child.wait();
}

pub fn shutdown_backend(state: &BackendState) {
    let mut child_slot = match state.child.lock() {
        Ok(guard) => guard,
        Err(poisoned) => poisoned.into_inner(),
    };

    if let Some(mut child) = child_slot.take() {
        terminate_child_process(&mut child);
    }

    let mut port_slot = match state.port.lock() {
        Ok(guard) => guard,
        Err(poisoned) => poisoned.into_inner(),
    };
    *port_slot = None;

    let mut started_at_slot = match state.started_at.lock() {
        Ok(guard) => guard,
        Err(poisoned) => poisoned.into_inner(),
    };
    *started_at_slot = None;
}
