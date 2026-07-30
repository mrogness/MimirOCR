use std::path::PathBuf;
use std::time::Instant;

use super::discovery::{backend_mode, find_open_port, has_uvicorn, python_candidates, sidecar_candidates};
use super::process::{
    backend_runtime_paths, ensure_child_is_running, shutdown_backend, try_spawn_backend,
    try_spawn_backend_sidecar,
};
use super::profile::{load_profile, save_profile, PerformanceProfile};
use super::state::{
    frontend_backend_url, BackendRestartResult, BackendRuntimePaths, BackendState,
};

struct LaunchSelection {
    child: std::process::Child,
    runtime: String,
    sidecar_path: Option<String>,
    python_path: Option<String>,
    sidecar_checked: Vec<String>,
    python_checked: Vec<String>,
}

pub fn launch_initial_backend(app: &tauri::App, state: &BackendState) -> Result<(), String> {
    let runtime_paths = backend_runtime_paths(app, &state.project_root);
    store_runtime_paths(state, runtime_paths.clone());
    let profile = load_profile(&runtime_paths);
    let port = find_open_port().unwrap_or(8080);
    let selection = discover_and_spawn(app, state, &runtime_paths, port, profile)?;
    install_selection(state, selection, port, profile);
    Ok(())
}

pub fn restart_backend_with_profile(
    state: &BackendState,
    profile: PerformanceProfile,
) -> Result<BackendRestartResult, String> {
    let runtime_paths = state.runtime_paths()?;
    save_profile(&runtime_paths, profile)?;

    let port = {
        let slot = state
            .port
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        (*slot).unwrap_or_else(|| find_open_port().unwrap_or(8080))
    };
    let runtime = state
        .backend_runtime
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
        .clone();
    let sidecar_path = state
        .sidecar_selected_path
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
        .clone();
    let python_path = state
        .python_selected_path
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
        .clone();
    let sidecar_log_path = runtime_paths.cache_dir.join("sidecar.log");

    shutdown_backend(state);

    let child = match runtime.as_str() {
        "sidecar" => {
            let path = sidecar_path
                .as_ref()
                .map(PathBuf::from)
                .ok_or_else(|| "No selected sidecar is available for restart".to_string())?;
            try_spawn_backend_sidecar(&path, port, &runtime_paths, &sidecar_log_path, profile)
                .and_then(|child| ensure_child_is_running(child, &format!("Sidecar {}", path.display())))
        }
        "python" => {
            let python = python_path
                .as_ref()
                .ok_or_else(|| "No selected Python runtime is available for restart".to_string())?;
            try_spawn_backend(
                python,
                &state.project_root,
                port,
                state.use_reload,
                &runtime_paths,
                profile,
            )
            .and_then(|child| ensure_child_is_running(child, &format!("Python backend {python}")))
        }
        other => return Err(format!("Backend runtime '{other}' cannot be restarted")),
    }
    .map_err(|error| error.to_string())?;

    let selection = LaunchSelection {
        child,
        runtime,
        sidecar_path,
        python_path,
        sidecar_checked: state
            .sidecar_checked_paths
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .clone(),
        python_checked: state
            .python_checked_candidates
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .clone(),
    };
    install_selection(state, selection, port, profile);

    let generation = {
        let mut slot = state
            .restart_generation
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        *slot += 1;
        *slot
    };

    Ok(BackendRestartResult {
        url: frontend_backend_url(port),
        active_profile: profile.as_str().to_string(),
        restart_generation: generation,
    })
}

fn discover_and_spawn(
    app: &tauri::App,
    state: &BackendState,
    runtime_paths: &BackendRuntimePaths,
    port: u16,
    profile: PerformanceProfile,
) -> Result<LaunchSelection, String> {
    let requested_mode = backend_mode();
    let mode = if cfg!(debug_assertions) {
        requested_mode.clone()
    } else {
        "sidecar".to_string()
    };
    *state.backend_mode.lock().unwrap_or_else(|p| p.into_inner()) = mode.clone();

    let sidecar_log_path = runtime_paths.cache_dir.join("sidecar.log");
    let mut sidecar_checked = Vec::new();
    let mut python_checked = Vec::new();
    let mut last_error = String::new();

    let try_sidecars = |sidecar_checked: &mut Vec<String>, last_error: &mut String| {
        for candidate in sidecar_candidates(&state.project_root, app) {
            sidecar_checked.push(candidate.display().to_string());
            if !candidate.exists() {
                continue;
            }
            match try_spawn_backend_sidecar(
                &candidate,
                port,
                runtime_paths,
                &sidecar_log_path,
                profile,
            )
            .and_then(|child| {
                ensure_child_is_running(child, &format!("Sidecar {}", candidate.display()))
            }) {
                Ok(child) => {
                    return Some(LaunchSelection {
                        child,
                        runtime: "sidecar".to_string(),
                        sidecar_path: Some(candidate.display().to_string()),
                        python_path: None,
                        sidecar_checked: sidecar_checked.clone(),
                        python_checked: Vec::new(),
                    });
                }
                Err(error) => *last_error = error.to_string(),
            }
        }
        None
    };

    let try_python = |python_checked: &mut Vec<String>, last_error: &mut String, reload: bool| {
        for candidate in python_candidates(&state.project_root) {
            python_checked.push(candidate.clone());
            if !has_uvicorn(&candidate, &state.project_root) {
                continue;
            }
            match try_spawn_backend(
                &candidate,
                &state.project_root,
                port,
                reload,
                runtime_paths,
                profile,
            )
            .and_then(|child| ensure_child_is_running(child, &format!("Python backend {candidate}")))
            {
                Ok(child) => {
                    return Some(LaunchSelection {
                        child,
                        runtime: "python".to_string(),
                        sidecar_path: None,
                        python_path: Some(candidate),
                        sidecar_checked: Vec::new(),
                        python_checked: python_checked.clone(),
                    });
                }
                Err(error) => *last_error = error.to_string(),
            }
        }
        None
    };

    let selection = match mode.as_str() {
        "python" => try_python(&mut python_checked, &mut last_error, state.use_reload),
        "sidecar" => try_sidecars(&mut sidecar_checked, &mut last_error),
        _ => try_sidecars(&mut sidecar_checked, &mut last_error)
            .or_else(|| try_python(&mut python_checked, &mut last_error, false)),
    };

    selection.ok_or_else(|| {
        let message = format!(
            "Unable to start backend in '{mode}' mode. Sidecars checked: {}. Python candidates checked: {}. Last error: {}",
            sidecar_checked.join(", "),
            python_checked.join(", "),
            if last_error.is_empty() { "none" } else { &last_error },
        );
        *state.startup_error.lock().unwrap_or_else(|p| p.into_inner()) = Some(message.clone());
        *state.lifecycle_status.lock().unwrap_or_else(|p| p.into_inner()) = "failed".to_string();
        message
    })
}

fn store_runtime_paths(state: &BackendState, paths: BackendRuntimePaths) {
    *state.runtime_paths.lock().unwrap_or_else(|p| p.into_inner()) = Some(paths.clone());
    *state.app_data_dir.lock().unwrap_or_else(|p| p.into_inner()) =
        Some(paths.app_data_dir.display().to_string());
    *state.cache_dir.lock().unwrap_or_else(|p| p.into_inner()) =
        Some(paths.cache_dir.display().to_string());
    *state.temp_dir.lock().unwrap_or_else(|p| p.into_inner()) =
        Some(paths.temp_dir.display().to_string());
    *state.db_path.lock().unwrap_or_else(|p| p.into_inner()) =
        Some(paths.app_data_dir.join("app_data.db").display().to_string());
    *state.uploads_dir.lock().unwrap_or_else(|p| p.into_inner()) =
        Some(paths.app_data_dir.join("uploads").display().to_string());
    *state.output_dir.lock().unwrap_or_else(|p| p.into_inner()) =
        Some(paths.cache_dir.join("output").display().to_string());
    *state.sidecar_log_path.lock().unwrap_or_else(|p| p.into_inner()) =
        Some(paths.cache_dir.join("sidecar.log").display().to_string());
}

fn install_selection(
    state: &BackendState,
    selection: LaunchSelection,
    port: u16,
    profile: PerformanceProfile,
) {
    *state.child.lock().unwrap_or_else(|p| p.into_inner()) = Some(selection.child);
    *state.port.lock().unwrap_or_else(|p| p.into_inner()) = Some(port);
    *state.started_at.lock().unwrap_or_else(|p| p.into_inner()) = Some(Instant::now());
    *state.startup_error.lock().unwrap_or_else(|p| p.into_inner()) = None;
    *state.backend_runtime.lock().unwrap_or_else(|p| p.into_inner()) = selection.runtime;
    *state.lifecycle_status.lock().unwrap_or_else(|p| p.into_inner()) = "running".to_string();
    *state.active_profile.lock().unwrap_or_else(|p| p.into_inner()) = profile.as_str().to_string();
    *state.sidecar_selected_path.lock().unwrap_or_else(|p| p.into_inner()) = selection.sidecar_path;
    *state.python_selected_path.lock().unwrap_or_else(|p| p.into_inner()) = selection.python_path;
    if !selection.sidecar_checked.is_empty() {
        *state.sidecar_checked_paths.lock().unwrap_or_else(|p| p.into_inner()) = selection.sidecar_checked;
    }
    if !selection.python_checked.is_empty() {
        *state.python_checked_candidates.lock().unwrap_or_else(|p| p.into_inner()) = selection.python_checked;
    }
}
