use std::env;
use std::path::PathBuf;

use tauri::{Manager, RunEvent};

mod backend;

use backend::commands::{backend_status, backend_url, greet, restart_backend};
use backend::launcher::launch_initial_backend;
use backend::process::shutdown_backend;
use backend::state::BackendState;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let project_root = manifest_dir
        .parent()
        .map(|path| path.to_path_buf())
        .unwrap_or(manifest_dir);

    tauri::Builder::default()
        .manage(BackendState::new(project_root))
        .setup(|app| {
            let state = app.state::<BackendState>();
            if let Err(error) = launch_initial_backend(app, &state) {
                eprintln!("{error}");
            }
            Ok(())
        })
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            greet,
            backend_url,
            backend_status,
            restart_backend,
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app_handle, event| match event {
            RunEvent::ExitRequested { .. } | RunEvent::Exit => {
                let state = app_handle.state::<BackendState>();
                shutdown_backend(&state);
            }
            RunEvent::WindowEvent {
                event: tauri::WindowEvent::Destroyed,
                ..
            } => {
                let state = app_handle.state::<BackendState>();
                shutdown_backend(&state);
            }
            _ => {}
        });
}
