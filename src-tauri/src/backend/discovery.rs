use std::env;
use std::net::TcpListener;
use std::path::PathBuf;
use std::process::{Command, Stdio};

use tauri::{path::BaseDirectory, Manager};

const DEFAULT_DEVELOPMENT_PYTHON: &str =
    "/Users/matthew/personal-projects/fraktur/mimir-venv/venv/bin/python";
const PACKAGED_BACKEND_DIRECTORY: &str = "backend-runtime";
const PACKAGED_BACKEND_NAME: &str = "backend-runtime";

pub fn find_open_port() -> std::io::Result<u16> {
    let listener = TcpListener::bind("127.0.0.1:0")?;
    let port = listener.local_addr()?.port();
    drop(listener);
    Ok(port)
}

pub fn python_candidates(_project_root: &PathBuf) -> Vec<String> {
    if let Ok(custom) = env::var("MIMIR_PYTHON") {
        let custom = custom.trim();
        if !custom.is_empty() {
            return vec![custom.to_string()];
        }
    }

    vec![DEFAULT_DEVELOPMENT_PYTHON.to_string()]
}

pub fn has_uvicorn(python_bin: &str, project_root: &PathBuf) -> bool {
    let status = Command::new(python_bin)
        .arg("-c")
        .arg("import uvicorn")
        .current_dir(project_root)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status();

    match status {
        Ok(exit_status) => exit_status.success(),
        Err(_) => false,
    }
}

pub fn backend_mode() -> String {
    if cfg!(debug_assertions) {
        "python".to_string()
    } else {
        "sidecar".to_string()
    }
}

fn packaged_backend_filename() -> &'static str {
    if cfg!(target_os = "windows") {
        "backend-runtime.exe"
    } else {
        PACKAGED_BACKEND_NAME
    }
}

pub fn sidecar_candidates(_project_root: &PathBuf, app: &tauri::App) -> Vec<PathBuf> {
    let relative_path =
        PathBuf::from(PACKAGED_BACKEND_DIRECTORY).join(packaged_backend_filename());

    match app.path().resolve(relative_path, BaseDirectory::Resource) {
        Ok(path) => vec![path],
        Err(error) => {
            eprintln!("Unable to resolve packaged backend resource path: {error}");
            Vec::new()
        }
    }
}
