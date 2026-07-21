use tauri::State;

use super::state::{
    frontend_backend_url, reconcile_backend_child_state, BackendState, BackendStatus,
};

#[tauri::command]
pub fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

#[tauri::command]
pub fn backend_url(state: State<'_, BackendState>) -> Option<String> {
    reconcile_backend_child_state(&state);

    let port_slot = match state.port.lock() {
        Ok(guard) => guard,
        Err(poisoned) => poisoned.into_inner(),
    };

    port_slot.map(frontend_backend_url)
}

#[tauri::command]
pub fn backend_status(state: State<'_, BackendState>) -> BackendStatus {
    reconcile_backend_child_state(&state);

    let port_slot = match state.port.lock() {
        Ok(guard) => guard,
        Err(poisoned) => poisoned.into_inner(),
    };

    let startup_error_slot = match state.startup_error.lock() {
        Ok(guard) => guard,
        Err(poisoned) => poisoned.into_inner(),
    };

    let started_at_slot = match state.started_at.lock() {
        Ok(guard) => guard,
        Err(poisoned) => poisoned.into_inner(),
    };

    let sidecar_selected_slot = match state.sidecar_selected_path.lock() {
        Ok(guard) => guard,
        Err(poisoned) => poisoned.into_inner(),
    };

    let sidecar_checked_slot = match state.sidecar_checked_paths.lock() {
        Ok(guard) => guard,
        Err(poisoned) => poisoned.into_inner(),
    };

    let sidecar_log_slot = match state.sidecar_log_path.lock() {
        Ok(guard) => guard,
        Err(poisoned) => poisoned.into_inner(),
    };

    let backend_mode_slot = match state.backend_mode.lock() {
        Ok(guard) => guard,
        Err(poisoned) => poisoned.into_inner(),
    };

    let backend_runtime_slot = match state.backend_runtime.lock() {
        Ok(guard) => guard,
        Err(poisoned) => poisoned.into_inner(),
    };

    let python_selected_slot = match state.python_selected_path.lock() {
        Ok(guard) => guard,
        Err(poisoned) => poisoned.into_inner(),
    };

    let python_checked_slot = match state.python_checked_candidates.lock() {
        Ok(guard) => guard,
        Err(poisoned) => poisoned.into_inner(),
    };

    BackendStatus {
        url: port_slot.map(frontend_backend_url),
        uptime_seconds: started_at_slot
            .as_ref()
            .map(|started_at| started_at.elapsed().as_secs()),
        startup_error: startup_error_slot.clone(),
        backend_mode: backend_mode_slot.clone(),
        backend_runtime: backend_runtime_slot.clone(),
        sidecar_selected_path: sidecar_selected_slot.clone(),
        sidecar_checked_paths: sidecar_checked_slot.clone(),
        sidecar_log_path: sidecar_log_slot.clone(),
        python_selected_path: python_selected_slot.clone(),
        python_checked_candidates: python_checked_slot.clone(),
    }
}
