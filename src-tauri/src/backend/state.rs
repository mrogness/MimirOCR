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

pub fn tail_log(path: &str, max_lines: usize) -> Option<String> {
    let content = fs::read_to_string(path).ok()?;
    let mut lines: Vec<&str> = content.lines().collect();
    if lines.len() > max_lines {
        lines = lines.split_off(lines.len() - max_lines);
    }
    if lines.is_empty() {
        return None;
    }
    Some(lines.join("\n"))
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
    let mut child_slot = match state.child.lock() {
        Ok(guard) => guard,
        Err(poisoned) => poisoned.into_inner(),
    };

    let Some(child) = child_slot.as_mut() else {
        return;
    };

    let exited = match child.try_wait() {
        Ok(Some(status)) => Some(status.to_string()),
        Ok(None) => None,
        Err(err) => Some(format!("unable to poll process status: {err}")),
    };

    let Some(exit_detail) = exited else {
        return;
    };

    *child_slot = None;

    {
        let mut port_slot = match state.port.lock() {
            Ok(guard) => guard,
            Err(poisoned) => poisoned.into_inner(),
        };
        *port_slot = None;
    }

    {
        let mut runtime_slot = match state.backend_runtime.lock() {
            Ok(guard) => guard,
            Err(poisoned) => poisoned.into_inner(),
        };
        *runtime_slot = "none".to_string();
    }

    {
        let mut started_at_slot = match state.started_at.lock() {
            Ok(guard) => guard,
            Err(poisoned) => poisoned.into_inner(),
        };
        *started_at_slot = None;
    }

    let selected_sidecar = {
        let slot = match state.sidecar_selected_path.lock() {
            Ok(guard) => guard,
            Err(poisoned) => poisoned.into_inner(),
        };
        slot.clone()
    };

    let selected_python = {
        let slot = match state.python_selected_path.lock() {
            Ok(guard) => guard,
            Err(poisoned) => poisoned.into_inner(),
        };
        slot.clone()
    };

    let sidecar_log_path = {
        let slot = match state.sidecar_log_path.lock() {
            Ok(guard) => guard,
            Err(poisoned) => poisoned.into_inner(),
        };
        slot.clone()
    };

    let process_label = selected_sidecar
        .map(|p| format!("sidecar at {p}"))
        .or_else(|| selected_python.map(|p| format!("python backend via {p}")))
        .unwrap_or_else(|| "backend process".to_string());

    let mut startup_error_slot = match state.startup_error.lock() {
        Ok(guard) => guard,
        Err(poisoned) => poisoned.into_inner(),
    };

    let mut message = format!(
        "Backend process exited after startup ({process_label}): {exit_detail}"
    );

    if let Some(log_path) = sidecar_log_path {
        if let Some(tail) = tail_log(&log_path, 80) {
            message.push_str(". Sidecar log tail:\n");
            message.push_str(&tail);
        } else {
            message.push_str(&format!(". Sidecar log file: {log_path}"));
        }
    }

    *startup_error_slot = Some(message);
}
