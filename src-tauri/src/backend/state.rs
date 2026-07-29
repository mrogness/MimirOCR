use std::fs;
use std::path::PathBuf;
use std::process::Child;
use std::sync::Mutex;
use std::time::Instant;

pub struct BackendState {
    pub child: Mutex<Option<Child>>,
    pub port: Mutex<Option<u16>>,
    pub started_at: Mutex<Option<Instant>>,
    pub startup_error: Mutex<Option<String>>,
    pub backend_mode: Mutex<String>,
    pub backend_runtime: Mutex<String>,
    pub lifecycle_status: Mutex<String>,
    pub active_profile: Mutex<String>,
    pub restart_generation: Mutex<u64>,
    pub lifecycle_lock: Mutex<()>,
    pub sidecar_selected_path: Mutex<Option<String>>,
    pub sidecar_checked_paths: Mutex<Vec<String>>,
    pub sidecar_log_path: Mutex<Option<String>>,
    pub python_selected_path: Mutex<Option<String>>,
    pub python_checked_candidates: Mutex<Vec<String>>,
    pub app_data_dir: Mutex<Option<String>>,
    pub cache_dir: Mutex<Option<String>>,
    pub temp_dir: Mutex<Option<String>>,
    pub db_path: Mutex<Option<String>>,
    pub uploads_dir: Mutex<Option<String>>,
    pub output_dir: Mutex<Option<String>>,
    pub runtime_paths: Mutex<Option<BackendRuntimePaths>>,
    pub project_root: PathBuf,
    pub use_reload: bool,
}

impl BackendState {
    pub fn new(project_root: PathBuf) -> Self {
        Self {
            child: Mutex::new(None),
            port: Mutex::new(None),
            started_at: Mutex::new(None),
            startup_error: Mutex::new(None),
            backend_mode: Mutex::new("unknown".to_string()),
            backend_runtime: Mutex::new("none".to_string()),
            lifecycle_status: Mutex::new("starting".to_string()),
            active_profile: Mutex::new("balanced".to_string()),
            restart_generation: Mutex::new(0),
            lifecycle_lock: Mutex::new(()),
            sidecar_selected_path: Mutex::new(None),
            sidecar_checked_paths: Mutex::new(Vec::new()),
            sidecar_log_path: Mutex::new(None),
            python_selected_path: Mutex::new(None),
            python_checked_candidates: Mutex::new(Vec::new()),
            app_data_dir: Mutex::new(None),
            cache_dir: Mutex::new(None),
            temp_dir: Mutex::new(None),
            db_path: Mutex::new(None),
            uploads_dir: Mutex::new(None),
            output_dir: Mutex::new(None),
            runtime_paths: Mutex::new(None),
            project_root,
            use_reload: cfg!(debug_assertions),
        }
    }

    pub fn runtime_paths(&self) -> Result<BackendRuntimePaths, String> {
        self.runtime_paths
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .clone()
            .ok_or_else(|| "Backend runtime paths are not initialized".to_string())
    }
}

#[derive(Clone)]
pub struct BackendRuntimePaths {
    pub app_data_dir: PathBuf,
    pub cache_dir: PathBuf,
    pub temp_dir: PathBuf,
}

#[derive(serde::Serialize)]
pub struct BackendStatus {
    pub url: Option<String>,
    pub uptime_seconds: Option<u64>,
    pub startup_error: Option<String>,
    pub backend_mode: String,
    pub backend_runtime: String,
    pub lifecycle_status: String,
    pub active_profile: String,
    pub restart_generation: u64,
    pub sidecar_selected_path: Option<String>,
    pub sidecar_checked_paths: Vec<String>,
    pub sidecar_log_path: Option<String>,
    pub python_selected_path: Option<String>,
    pub python_checked_candidates: Vec<String>,
    pub app_data_dir: Option<String>,
    pub cache_dir: Option<String>,
    pub temp_dir: Option<String>,
    pub db_path: Option<String>,
    pub uploads_dir: Option<String>,
    pub output_dir: Option<String>,
}

#[derive(serde::Serialize)]
pub struct BackendRestartResult {
    pub url: String,
    pub active_profile: String,
    pub restart_generation: u64,
}

pub fn tail_log(path: &str, max_lines: usize) -> Option<String> {
    let content = fs::read_to_string(path).ok()?;
    let mut lines: Vec<&str> = content.lines().collect();
    if lines.len() > max_lines {
        lines = lines.split_off(lines.len() - max_lines);
    }
    (!lines.is_empty()).then(|| lines.join("\n"))
}

pub fn frontend_backend_url(port: u16) -> String {
    #[cfg(target_os = "windows")]
    {
        return format!("http://localhost:{port}");
    }
    #[cfg(not(target_os = "windows"))]
    {
        format!("http://127.0.0.1:{port}")
    }
}

pub fn reconcile_backend_child_state(state: &BackendState) {
    let mut child_slot = state.child.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
    let Some(child) = child_slot.as_mut() else {
        return;
    };

    let exited = match child.try_wait() {
        Ok(Some(status)) => Some(status.to_string()),
        Ok(None) => None,
        Err(error) => Some(format!("unable to poll process status: {error}")),
    };
    let Some(exit_detail) = exited else {
        return;
    };
    *child_slot = None;
    drop(child_slot);

    *state.port.lock().unwrap_or_else(|p| p.into_inner()) = None;
    *state.started_at.lock().unwrap_or_else(|p| p.into_inner()) = None;
    *state.backend_runtime.lock().unwrap_or_else(|p| p.into_inner()) = "none".to_string();
    *state.lifecycle_status.lock().unwrap_or_else(|p| p.into_inner()) = "failed".to_string();

    let selected_sidecar = state.sidecar_selected_path.lock().unwrap_or_else(|p| p.into_inner()).clone();
    let selected_python = state.python_selected_path.lock().unwrap_or_else(|p| p.into_inner()).clone();
    let log_path = state.sidecar_log_path.lock().unwrap_or_else(|p| p.into_inner()).clone();
    let process_label = selected_sidecar
        .map(|path| format!("sidecar at {path}"))
        .or_else(|| selected_python.map(|path| format!("python backend via {path}")))
        .unwrap_or_else(|| "backend process".to_string());

    let mut message = format!("Backend process exited after startup ({process_label}): {exit_detail}");
    if let Some(path) = log_path {
        if let Some(tail) = tail_log(&path, 80) {
            message.push_str(". Sidecar log tail:\n");
            message.push_str(&tail);
        }
    }
    *state.startup_error.lock().unwrap_or_else(|p| p.into_inner()) = Some(message);
}
