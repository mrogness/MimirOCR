use std::path::PathBuf;
use std::net::TcpListener;
use std::env;
use std::fs;
use std::fs::OpenOptions;
use std::collections::HashSet;
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use std::thread;
use std::time::{Duration, Instant};

#[cfg(unix)]
use std::os::unix::process::CommandExt;

use tauri::Manager;
use tauri::RunEvent;

struct BackendState {
    child: Mutex<Option<Child>>,
    port: Mutex<Option<u16>>,
    started_at: Mutex<Option<Instant>>,
    startup_error: Mutex<Option<String>>,
    backend_mode: Mutex<String>,
    backend_runtime: Mutex<String>,
    sidecar_selected_path: Mutex<Option<String>>,
    sidecar_checked_paths: Mutex<Vec<String>>,
    sidecar_log_path: Mutex<Option<String>>,
    python_selected_path: Mutex<Option<String>>,
    python_checked_candidates: Mutex<Vec<String>>,
}

#[derive(Clone)]
struct BackendRuntimePaths {
    app_data_dir: PathBuf,
    cache_dir: PathBuf,
    temp_dir: PathBuf,
}

#[derive(serde::Serialize)]
struct BackendStatus {
    url: Option<String>,
    uptime_seconds: Option<u64>,
    startup_error: Option<String>,
    backend_mode: String,
    backend_runtime: String,
    sidecar_selected_path: Option<String>,
    sidecar_checked_paths: Vec<String>,
    sidecar_log_path: Option<String>,
    python_selected_path: Option<String>,
    python_checked_candidates: Vec<String>,
}

fn tail_log(path: &str, max_lines: usize) -> Option<String> {
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

fn frontend_backend_url(port: u16) -> String {
    #[cfg(target_os = "windows")]
    {
        return format!("http://localhost:{port}");
    }

    #[cfg(not(target_os = "windows"))]
    {
        return format!("http://127.0.0.1:{port}");
    }
}

fn reconcile_backend_child_state(state: &BackendState) {
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

// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

#[tauri::command]
fn backend_url(state: tauri::State<'_, BackendState>) -> Option<String> {
    reconcile_backend_child_state(&state);

    let port_slot = match state.port.lock() {
        Ok(guard) => guard,
        Err(poisoned) => poisoned.into_inner(),
    };

    port_slot.map(frontend_backend_url)
}

#[tauri::command]
fn backend_status(state: tauri::State<'_, BackendState>) -> BackendStatus {
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
        uptime_seconds: started_at_slot.as_ref().map(|started_at| started_at.elapsed().as_secs()),
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

fn find_open_port() -> std::io::Result<u16> {
    let listener = TcpListener::bind("127.0.0.1:0")?;
    let port = listener.local_addr()?.port();
    drop(listener);
    Ok(port)
}

fn python_candidates(project_root: &PathBuf) -> Vec<String> {
    let mut out = Vec::new();

    if let Ok(custom) = env::var("MIMIR_PYTHON") {
        if !custom.trim().is_empty() {
            out.push(custom);
        }
    }

    if let Ok(custom) = env::var("PYTHON") {
        if !custom.trim().is_empty() {
            out.push(custom);
        }
    }

    if let Ok(virtual_env) = env::var("VIRTUAL_ENV") {
        if !virtual_env.trim().is_empty() {
            let virtual_env_python = if cfg!(target_os = "windows") {
                PathBuf::from(&virtual_env).join("Scripts").join("python.exe")
            } else {
                PathBuf::from(&virtual_env).join("bin").join("python")
            };

            if virtual_env_python.exists() {
                out.push(virtual_env_python.to_string_lossy().to_string());
            }
        }
    }

    let local_venv = if cfg!(target_os = "windows") {
        project_root.join(".venv").join("Scripts").join("python.exe")
    } else {
        project_root.join(".venv").join("bin").join("python")
    };
    if local_venv.exists() {
        out.push(local_venv.to_string_lossy().to_string());
    }

    let local_venv_alt = if cfg!(target_os = "windows") {
        project_root.join("venv").join("Scripts").join("python.exe")
    } else {
        project_root.join("venv").join("bin").join("python")
    };
    if local_venv_alt.exists() {
        out.push(local_venv_alt.to_string_lossy().to_string());
    }

    if let Ok(conda_prefix) = env::var("CONDA_PREFIX") {
        if !conda_prefix.trim().is_empty() {
            let conda_python = if cfg!(target_os = "windows") {
                PathBuf::from(&conda_prefix).join("python.exe")
            } else {
                PathBuf::from(&conda_prefix).join("bin").join("python")
            };

            if conda_python.exists() {
                out.push(conda_python.to_string_lossy().to_string());
            }
        }
    }

    out.push("python3".to_string());
    out.push("python".to_string());

    out
}

fn has_uvicorn(python_bin: &str, project_root: &PathBuf) -> bool {
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

fn backend_runtime_paths(app: &tauri::App, project_root: &PathBuf) -> BackendRuntimePaths {
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

fn backend_mode() -> String {
    if let Ok(mode) = env::var("MIMIR_BACKEND_MODE") {
        let normalized = mode.trim().to_lowercase();
        if !normalized.is_empty() {
            return normalized;
        }
    }

    if cfg!(debug_assertions) {
        "python".to_string()
    } else {
        "auto".to_string()
    }
}

fn compile_time_target_triple() -> Option<String> {
    fn normalize_target(raw: &str) -> Option<String> {
        let target = raw.trim();
        if target.is_empty() {
            return None;
        }

        let lowered = target.to_ascii_lowercase();
        if lowered.contains("unknown-target") || lowered == "unknown" {
            return None;
        }

        if !target.contains('-') {
            return None;
        }

        Some(target.to_string())
    }

    if let Some(target) = option_env!("TARGET") {
        if let Some(normalized) = normalize_target(target) {
            return Some(normalized);
        }
    }

    // Fallback for environments where TARGET is not exposed.
    let arch = option_env!("CARGO_CFG_TARGET_ARCH")?;
    let vendor = option_env!("CARGO_CFG_TARGET_VENDOR")?;
    let os_raw = option_env!("CARGO_CFG_TARGET_OS")?;
    let env_part = option_env!("CARGO_CFG_TARGET_ENV").unwrap_or("");

    let os = match os_raw {
        "macos" => "darwin",
        other => other,
    };

    let mut triple = format!("{arch}-{vendor}-{os}");
    if !env_part.trim().is_empty() {
        triple.push('-');
        triple.push_str(env_part);
    }
    normalize_target(&triple)
}

fn sidecar_binary_name() -> Option<String> {
    // Matches scripts/build_backend_sidecar.mjs output (backend-<triple>)
    compile_time_target_triple().map(|target| format!("backend-{target}"))
}

fn with_executable_variants(base: PathBuf) -> Vec<PathBuf> {
    #[allow(unused_mut)]
    let mut variants = vec![base.clone()];
    #[cfg(target_os = "windows")]
    {
        if base.extension().is_none() {
            variants.push(base.with_extension("exe"));
        }
    }
    variants
}

fn push_sidecar_name_candidates<F>(base_dir: &PathBuf, binary_name: Option<&String>, mut push_candidate: F)
where
    F: FnMut(PathBuf),
{
    for candidate in with_executable_variants(base_dir.join("backend")) {
        push_candidate(candidate);
    }

    if let Some(name) = binary_name {
        for candidate in with_executable_variants(base_dir.join(name)) {
            push_candidate(candidate);
        }
    }

    for candidate in with_executable_variants(base_dir.join("binaries").join("backend")) {
        push_candidate(candidate);
    }

    if let Some(name) = binary_name {
        for candidate in with_executable_variants(base_dir.join("binaries").join(name)) {
            push_candidate(candidate);
        }
    }
}

fn push_sidecar_onedir_candidates<F>(base_dir: &PathBuf, binary_name: Option<&String>, mut push_candidate: F)
where
    F: FnMut(PathBuf),
{
    // PyInstaller --onedir layout:
    // <base>/<binary-name>/<binary-name>[.exe]
    if let Some(name) = binary_name {
        let bundle_dir = base_dir.join(name);
        for candidate in with_executable_variants(bundle_dir.join(name)) {
            push_candidate(candidate);
        }
        for candidate in with_executable_variants(bundle_dir.join("backend")) {
            push_candidate(candidate);
        }

        let nested_bundle_dir = base_dir.join("binaries").join(name);
        for candidate in with_executable_variants(nested_bundle_dir.join(name)) {
            push_candidate(candidate);
        }
        for candidate in with_executable_variants(nested_bundle_dir.join("backend")) {
            push_candidate(candidate);
        }
    }

    // Generic fallbacks for manually renamed bundle folders.
    for candidate in with_executable_variants(base_dir.join("backend").join("backend")) {
        push_candidate(candidate);
    }
    for candidate in with_executable_variants(base_dir.join("binaries").join("backend").join("backend")) {
        push_candidate(candidate);
    }
}

fn macos_bundle_root_from_executable(exe_path: &PathBuf) -> Option<PathBuf> {
    for ancestor in exe_path.ancestors() {
        let file_name = ancestor.file_name()?.to_string_lossy().to_ascii_lowercase();
        if file_name.ends_with(".app") {
            return Some(ancestor.to_path_buf());
        }
    }

    None
}

fn macos_bundle_root_from_resources_dir(resource_dir: &PathBuf) -> Option<PathBuf> {
    let resources_name = resource_dir.file_name()?.to_string_lossy().to_ascii_lowercase();
    if resources_name != "resources" {
        return None;
    }

    let contents_dir = resource_dir.parent()?;
    let contents_name = contents_dir.file_name()?.to_string_lossy().to_ascii_lowercase();
    if contents_name != "contents" {
        return None;
    }

    Some(contents_dir.parent()?.to_path_buf())
}

fn push_sidecar_scan_candidates<F>(base_dir: &PathBuf, mut push_candidate: F)
where
    F: FnMut(PathBuf),
{
    let mut scan_dirs = vec![base_dir.clone(), base_dir.join("binaries")];

    for dir in scan_dirs.drain(..) {
        if let Ok(entries) = fs::read_dir(&dir) {
            for entry in entries.flatten() {
                let path = entry.path();
                if path.is_file() {
                    if let Some(file_name) = path.file_name().and_then(|name| name.to_str()) {
                        if file_name == "backend" || file_name.starts_with("backend-") {
                            push_candidate(path.clone());
                            #[cfg(target_os = "windows")]
                            if let Some(ext) = path.extension().and_then(|e| e.to_str()) {
                                if ext.eq_ignore_ascii_case("exe") {
                                    push_candidate(path.with_extension(""));
                                }
                            }
                        }
                    }
                    continue;
                }

                if path.is_dir() {
                    if let Some(dir_name) = path.file_name().and_then(|name| name.to_str()) {
                        if dir_name == "backend" || dir_name.starts_with("backend-") {
                            for candidate in with_executable_variants(path.join(dir_name)) {
                                push_candidate(candidate);
                            }
                            for candidate in with_executable_variants(path.join("backend")) {
                                push_candidate(candidate);
                            }
                        }
                    }
                }
            }
        }
    }
}

fn sidecar_candidates(project_root: &PathBuf, app: &tauri::App) -> Vec<PathBuf> {
    let mut out = Vec::new();
    let mut seen: HashSet<PathBuf> = HashSet::new();
    let binary_name = sidecar_binary_name();

    let mut push_candidate = |path: PathBuf| {
        if seen.insert(path.clone()) {
            out.push(path);
        }
    };

    // Packaged macOS/Linux/Windows app should prefer executable-dir sidecar.
    if let Ok(executable_dir) = app.path().executable_dir() {
        push_sidecar_name_candidates(&executable_dir, binary_name.as_ref(), &mut push_candidate);
        push_sidecar_onedir_candidates(&executable_dir, binary_name.as_ref(), &mut push_candidate);
        push_sidecar_scan_candidates(&executable_dir, &mut push_candidate);
    }

    // Tauri resource directory fallback.
    if let Ok(resource_dir) = app.path().resource_dir() {
        push_sidecar_name_candidates(&resource_dir, binary_name.as_ref(), &mut push_candidate);
        push_sidecar_onedir_candidates(&resource_dir, binary_name.as_ref(), &mut push_candidate);
        push_sidecar_scan_candidates(&resource_dir, &mut push_candidate);

        // On macOS, resource_dir is usually <Bundle>.app/Contents/Resources.
        // Reconstruct bundle root from that path and explicitly probe
        // <Bundle>.app/Contents/MacOS/backend first.
        if let Some(bundle_root) = macos_bundle_root_from_resources_dir(&resource_dir) {
            let contents_dir = bundle_root.join("Contents");
            let macos_dir = contents_dir.join("MacOS");
            push_sidecar_name_candidates(&macos_dir, binary_name.as_ref(), &mut push_candidate);
            push_sidecar_onedir_candidates(&macos_dir, binary_name.as_ref(), &mut push_candidate);
            push_sidecar_scan_candidates(&macos_dir, &mut push_candidate);
        }
    }

    // Extra fallback: resolve from running executable path directly.
    // On macOS this should produce: <App>.app/Contents/MacOS/backend
    if let Ok(current_exe) = env::current_exe() {
        if let Some(executable_dir) = current_exe.parent() {
            push_sidecar_name_candidates(&executable_dir.to_path_buf(), binary_name.as_ref(), &mut push_candidate);
            push_sidecar_onedir_candidates(&executable_dir.to_path_buf(), binary_name.as_ref(), &mut push_candidate);
            push_sidecar_scan_candidates(&executable_dir.to_path_buf(), &mut push_candidate);
        }

        // Bundle-root fallback: start from the app bundle root and resolve common
        // packaged sidecar locations. This explicitly covers macOS app bundles.
        if let Some(bundle_root) = macos_bundle_root_from_executable(&current_exe) {
            let contents_dir = bundle_root.join("Contents");
            for macos_dir_name in ["MacOS", "Macos", "macos"] {
                let candidate_dir = contents_dir.join(macos_dir_name);
                push_sidecar_name_candidates(&candidate_dir, binary_name.as_ref(), &mut push_candidate);
                push_sidecar_onedir_candidates(&candidate_dir, binary_name.as_ref(), &mut push_candidate);
                push_sidecar_scan_candidates(&candidate_dir, &mut push_candidate);
            }

            let resources_dir = contents_dir.join("Resources");
            push_sidecar_name_candidates(&resources_dir, binary_name.as_ref(), &mut push_candidate);
            push_sidecar_onedir_candidates(&resources_dir, binary_name.as_ref(), &mut push_candidate);
            push_sidecar_scan_candidates(&resources_dir, &mut push_candidate);
        }
    }

    // Development fallback: only allow project-local sidecars in debug builds.
    if cfg!(debug_assertions) {
        let dev_binaries_dir = project_root.join("src-tauri").join("binaries");
        if let Some(binary_name) = binary_name.as_ref() {
            for candidate in with_executable_variants(dev_binaries_dir.join(&binary_name)) {
                push_candidate(candidate);
            }
            for candidate in with_executable_variants(dev_binaries_dir.join(&binary_name).join(&binary_name)) {
                push_candidate(candidate);
            }
        }

        if let Ok(entries) = fs::read_dir(&dev_binaries_dir) {
            for entry in entries.flatten() {
                let path = entry.path();
                if !path.is_file() {
                    continue;
                }

                if let Some(file_name) = path.file_name().and_then(|name| name.to_str()) {
                    if file_name == "backend" || file_name.starts_with("backend-") {
                        push_candidate(path);
                    }
                }
            }
        }
    }

    out
}

fn try_spawn_backend_sidecar(
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
        .append(true)
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
        // Put backend in its own process group so shutdown can terminate the
        // whole subprocess tree (PyInstaller onefile parent/child, workers).
        cmd.process_group(0);
    }

    cmd.spawn()
}

fn try_spawn_backend(
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

fn ensure_child_is_running(mut child: Child, context: &str) -> std::io::Result<Child> {
    // Give the process a short window to fail fast (missing modules, bad entrypoint, etc.).
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
        // Kill the full process tree to avoid orphaned backend children.
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
        let pgid = format!("-{}", pid);

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

fn shutdown_backend(state: &BackendState) {
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
