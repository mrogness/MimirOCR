use tauri::State;

use super::launcher::restart_backend_with_profile;
use super::profile::{consume_restart_reservation, PerformanceProfile};
use super::state::{
    frontend_backend_url, reconcile_backend_child_state, BackendRestartResult, BackendState,
    BackendStatus,
};

#[tauri::command]
pub fn greet(name: &str) -> String {
    format!("Hello, {name}! You've been greeted from Rust!")
}

#[tauri::command]
pub fn backend_url(state: State<'_, BackendState>) -> Option<String> {
    reconcile_backend_child_state(&state);
    let slot = state
        .port
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    (*slot).map(frontend_backend_url)
}

#[tauri::command]
pub fn backend_status(state: State<'_, BackendState>) -> BackendStatus {
    reconcile_backend_child_state(&state);
    BackendStatus {
        url: {
            let slot = state.port.lock().unwrap_or_else(|p| p.into_inner());
            (*slot).map(frontend_backend_url)
        },
        uptime_seconds: state
            .started_at
            .lock()
            .unwrap_or_else(|p| p.into_inner())
            .as_ref()
            .map(|started_at| started_at.elapsed().as_secs()),
        startup_error: state.startup_error.lock().unwrap_or_else(|p| p.into_inner()).clone(),
        backend_mode: state.backend_mode.lock().unwrap_or_else(|p| p.into_inner()).clone(),
        backend_runtime: state.backend_runtime.lock().unwrap_or_else(|p| p.into_inner()).clone(),
        lifecycle_status: state.lifecycle_status.lock().unwrap_or_else(|p| p.into_inner()).clone(),
        active_profile: state.active_profile.lock().unwrap_or_else(|p| p.into_inner()).clone(),
        restart_generation: *state.restart_generation.lock().unwrap_or_else(|p| p.into_inner()),
        sidecar_selected_path: state.sidecar_selected_path.lock().unwrap_or_else(|p| p.into_inner()).clone(),
        sidecar_checked_paths: state.sidecar_checked_paths.lock().unwrap_or_else(|p| p.into_inner()).clone(),
        sidecar_log_path: state.sidecar_log_path.lock().unwrap_or_else(|p| p.into_inner()).clone(),
        python_selected_path: state.python_selected_path.lock().unwrap_or_else(|p| p.into_inner()).clone(),
        python_checked_candidates: state.python_checked_candidates.lock().unwrap_or_else(|p| p.into_inner()).clone(),
        app_data_dir: state.app_data_dir.lock().unwrap_or_else(|p| p.into_inner()).clone(),
        cache_dir: state.cache_dir.lock().unwrap_or_else(|p| p.into_inner()).clone(),
        temp_dir: state.temp_dir.lock().unwrap_or_else(|p| p.into_inner()).clone(),
        db_path: state.db_path.lock().unwrap_or_else(|p| p.into_inner()).clone(),
        uploads_dir: state.uploads_dir.lock().unwrap_or_else(|p| p.into_inner()).clone(),
        output_dir: state.output_dir.lock().unwrap_or_else(|p| p.into_inner()).clone(),
    }
}

#[tauri::command]
pub fn restart_backend(
    profile: String,
    restart_token: String,
    state: State<'_, BackendState>,
) -> Result<BackendRestartResult, String> {
    let profile = PerformanceProfile::parse(&profile)?;
    let _lifecycle_guard = state
        .lifecycle_lock
        .lock()
        .map_err(|_| "Backend lifecycle lock is poisoned".to_string())?;
    let runtime_paths = state.runtime_paths()?;
    consume_restart_reservation(&runtime_paths, &restart_token, profile)?;

    *state.lifecycle_status.lock().unwrap_or_else(|p| p.into_inner()) = "restarting".to_string();
    match restart_backend_with_profile(&state, profile) {
        Ok(result) => Ok(result),
        Err(error) => {
            let child_is_running = state
                .child
                .lock()
                .unwrap_or_else(|p| p.into_inner())
                .is_some();
            *state.lifecycle_status.lock().unwrap_or_else(|p| p.into_inner()) =
                if child_is_running { "running" } else { "failed" }.to_string();
            *state.startup_error.lock().unwrap_or_else(|p| p.into_inner()) = Some(error.clone());
            Err(error)
        }
    }
}
