use tauri::Manager;
use tauri::RunEvent;
use std::env;
use std::path::PathBuf;
use std::sync::Mutex;
use std::time::Instant;

mod backend;

use backend::commands::{backend_status, backend_url, greet};
use backend::discovery::{backend_mode, find_open_port, has_uvicorn, python_candidates, sidecar_candidates};
use backend::process::{
    backend_runtime_paths, ensure_child_is_running, shutdown_backend, try_spawn_backend,
    try_spawn_backend_sidecar,
};
use backend::state::{tail_log, BackendState};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let project_root = manifest_dir
        .parent()
        .map(|p| p.to_path_buf())
        .unwrap_or(manifest_dir.clone());

    tauri::Builder::default()
        .manage(BackendState {
            child: Mutex::new(None),
            port: Mutex::new(None),
            started_at: Mutex::new(None),
            startup_error: Mutex::new(None),
            backend_mode: Mutex::new("unknown".to_string()),
            backend_runtime: Mutex::new("none".to_string()),
            sidecar_selected_path: Mutex::new(None),
            sidecar_checked_paths: Mutex::new(Vec::new()),
            sidecar_log_path: Mutex::new(None),
            python_selected_path: Mutex::new(None),
            python_checked_candidates: Mutex::new(Vec::new()),
        })
        .setup(move |app| {
            let backend_state = app.state::<BackendState>();
            let runtime_paths = backend_runtime_paths(app, &project_root);
            let sidecar_log_path = runtime_paths.cache_dir.join("sidecar.log");
            let port = match find_open_port() {
                Ok(port) => port,
                Err(err) => {
                    eprintln!("Failed to select open backend port: {err}");
                    8080
                }
            };

            let mut child_result = Err(std::io::Error::new(
                std::io::ErrorKind::NotFound,
                "No backend sidecar or Python interpreter with uvicorn found",
            ));
            let mut sidecar_checked_paths: Vec<String> = Vec::new();
            let mut sidecar_selected_path: Option<String> = None;
            let mut python_selected_path: Option<String> = None;
            let mut sidecar_last_error: Option<String> = None;
            let mut python_checked_candidates: Vec<String> = Vec::new();
            let mut python_usable_candidates: Vec<String> = Vec::new();
            let mode = backend_mode();
            let mut backend_runtime = "none".to_string();
            let use_reload = cfg!(debug_assertions);

            if mode == "python" {
                let candidates = python_candidates(&project_root);
                for candidate in candidates {
                    python_checked_candidates.push(candidate.clone());
                    if !has_uvicorn(&candidate, &project_root) {
                        continue;
                    }

                    python_usable_candidates.push(candidate.clone());

                    child_result = try_spawn_backend(&candidate, &project_root, port, use_reload, &runtime_paths)
                        .and_then(|child| ensure_child_is_running(child, &format!("Python backend {}", candidate)));
                    if child_result.is_ok() {
                        python_selected_path = Some(candidate.clone());
                        backend_runtime = "python".to_string();
                        break;
                    }
                }

                if child_result.is_err() {
                    child_result = Err(std::io::Error::new(
                        std::io::ErrorKind::NotFound,
                        "Python backend mode selected but no working Python+uvicorn runtime was found",
                    ));
                }
            } else if mode == "sidecar" {
                for candidate in sidecar_candidates(&project_root, app) {
                    sidecar_checked_paths.push(candidate.display().to_string());
                    if !candidate.exists() {
                        continue;
                    }

                    child_result = try_spawn_backend_sidecar(&candidate, port, &runtime_paths, &sidecar_log_path)
                        .and_then(|child| ensure_child_is_running(child, &format!("Sidecar {}", candidate.display())));
                    if let Err(err) = &child_result {
                        sidecar_last_error = Some(err.to_string());
                    }
                    if child_result.is_ok() {
                        sidecar_selected_path = Some(candidate.display().to_string());
                        backend_runtime = "sidecar".to_string();
                        break;
                    }
                }
            } else {
                for candidate in sidecar_candidates(&project_root, app) {
                    sidecar_checked_paths.push(candidate.display().to_string());
                    if !candidate.exists() {
                        continue;
                    }

                    child_result = try_spawn_backend_sidecar(&candidate, port, &runtime_paths, &sidecar_log_path)
                        .and_then(|child| ensure_child_is_running(child, &format!("Sidecar {}", candidate.display())));
                    if let Err(err) = &child_result {
                        sidecar_last_error = Some(err.to_string());
                    }
                    if child_result.is_ok() {
                        sidecar_selected_path = Some(candidate.display().to_string());
                        backend_runtime = "sidecar".to_string();
                        break;
                    }
                }

                if child_result.is_err() {
                    let candidates = python_candidates(&project_root);
                    for candidate in candidates {
                        python_checked_candidates.push(candidate.clone());
                        if !has_uvicorn(&candidate, &project_root) {
                            continue;
                        }

                        python_usable_candidates.push(candidate.clone());

                        child_result = try_spawn_backend(&candidate, &project_root, port, false, &runtime_paths)
                            .and_then(|child| ensure_child_is_running(child, &format!("Python backend {}", candidate)));
                        if child_result.is_ok() {
                            python_selected_path = Some(candidate.clone());
                            backend_runtime = "python".to_string();
                            break;
                        }
                    }
                }
            }

            if child_result.is_err() {
                let mut details: Vec<String> = Vec::new();
                details.push(format!("Unable to start backend in '{mode}' mode"));

                if mode == "sidecar" || mode == "auto" {
                    if sidecar_checked_paths.is_empty() {
                        details.push("No sidecar candidate paths were discovered".to_string());
                    } else {
                        details.push(format!("Sidecar candidate paths checked: {}", sidecar_checked_paths.join(", ")));
                    }

                    if let Some(sidecar_err) = sidecar_last_error.as_ref() {
                        details.push(format!("Sidecar startup error: {sidecar_err}"));
                    }
                }

                if mode == "python" || mode == "auto" {
                    if python_checked_candidates.is_empty() {
                        details.push("No Python candidates were discovered".to_string());
                    } else {
                        details.push(format!("Python candidates checked: {}", python_checked_candidates.join(", ")));
                    }

                    if python_usable_candidates.is_empty() {
                        details.push("No Python candidate with uvicorn was found".to_string());
                    }
                }

                if let Err(err) = &child_result {
                    details.push(format!("Last startup error: {err}"));
                }

                child_result = Err(std::io::Error::new(
                    std::io::ErrorKind::NotFound,
                    details.join(". "),
                ));
            }

            {
                let mut slot = match backend_state.sidecar_selected_path.lock() {
                    Ok(guard) => guard,
                    Err(poisoned) => poisoned.into_inner(),
                };
                *slot = sidecar_selected_path.clone();
            }

            {
                let mut slot = match backend_state.sidecar_checked_paths.lock() {
                    Ok(guard) => guard,
                    Err(poisoned) => poisoned.into_inner(),
                };
                *slot = sidecar_checked_paths.clone();
            }

            {
                let mut slot = match backend_state.sidecar_log_path.lock() {
                    Ok(guard) => guard,
                    Err(poisoned) => poisoned.into_inner(),
                };
                *slot = Some(sidecar_log_path.display().to_string());
            }

            {
                let mut slot = match backend_state.python_selected_path.lock() {
                    Ok(guard) => guard,
                    Err(poisoned) => poisoned.into_inner(),
                };
                *slot = python_selected_path.clone();
            }

            {
                let mut slot = match backend_state.python_checked_candidates.lock() {
                    Ok(guard) => guard,
                    Err(poisoned) => poisoned.into_inner(),
                };
                *slot = python_checked_candidates.clone();
            }

            {
                let mut slot = match backend_state.backend_mode.lock() {
                    Ok(guard) => guard,
                    Err(poisoned) => poisoned.into_inner(),
                };
                *slot = mode.clone();
            }

            {
                let mut slot = match backend_state.backend_runtime.lock() {
                    Ok(guard) => guard,
                    Err(poisoned) => poisoned.into_inner(),
                };
                *slot = backend_runtime.clone();
            }

            match child_result {
                Ok(child) => {
                    let mut child_slot = match backend_state.child.lock() {
                        Ok(guard) => guard,
                        Err(poisoned) => poisoned.into_inner(),
                    };
                    *child_slot = Some(child);

                    let mut started_at_slot = match backend_state.started_at.lock() {
                        Ok(guard) => guard,
                        Err(poisoned) => poisoned.into_inner(),
                    };
                    *started_at_slot = Some(Instant::now());

                    let mut port_slot = match backend_state.port.lock() {
                        Ok(guard) => guard,
                        Err(poisoned) => poisoned.into_inner(),
                    };
                    *port_slot = Some(port);

                    let mut startup_error_slot = match backend_state.startup_error.lock() {
                        Ok(guard) => guard,
                        Err(poisoned) => poisoned.into_inner(),
                    };
                    *startup_error_slot = None;
                }
                Err(second_err) => {
                    let msg = format!(
                        "Failed to start backend process: {second_err}. Set MIMIR_BACKEND_MODE=python|sidecar|auto and optionally MIMIR_PYTHON to a Python with uvicorn installed."
                    );
                    let mut enriched_msg = msg.clone();
                    if let Some(tail) = tail_log(&sidecar_log_path.display().to_string(), 80) {
                        enriched_msg.push_str(" Sidecar log tail:\n");
                        enriched_msg.push_str(&tail);
                    }
                    eprintln!("{enriched_msg}");

                    let mut startup_error_slot = match backend_state.startup_error.lock() {
                        Ok(guard) => guard,
                        Err(poisoned) => poisoned.into_inner(),
                    };
                    *startup_error_slot = Some(enriched_msg);
                }
            }
            Ok(())
        })
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![greet, backend_url, backend_status])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app_handle, event| match event {
            RunEvent::ExitRequested { .. } | RunEvent::Exit => {
                let backend_state = app_handle.state::<BackendState>();
                shutdown_backend(&backend_state);
            }
            RunEvent::WindowEvent { event, .. } => {
                if let tauri::WindowEvent::Destroyed = event {
                    let backend_state = app_handle.state::<BackendState>();
                    shutdown_backend(&backend_state);
                }
            }
            _ => {}
        });
}
