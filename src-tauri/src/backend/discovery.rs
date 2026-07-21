use std::collections::HashSet;
use std::env;
use std::fs;
use std::net::TcpListener;
use std::path::PathBuf;
use std::process::{Command, Stdio};

use tauri::Manager;

pub fn find_open_port() -> std::io::Result<u16> {
    let listener = TcpListener::bind("127.0.0.1:0")?;
    let port = listener.local_addr()?.port();
    drop(listener);
    Ok(port)
}

pub fn python_candidates(project_root: &PathBuf) -> Vec<String> {
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

    let is_placeholder_name = |name: &str| -> bool {
        name == "backend-sentinel" || name == "backend-empty" || name == ".gitkeep"
    };

    for dir in scan_dirs.drain(..) {
        if let Ok(entries) = fs::read_dir(&dir) {
            for entry in entries.flatten() {
                let path = entry.path();
                if path.is_file() {
                    if let Some(file_name) = path.file_name().and_then(|name| name.to_str()) {
                        if is_placeholder_name(file_name) {
                            continue;
                        }

                        #[cfg(unix)]
                        {
                            use std::os::unix::fs::PermissionsExt;
                            match fs::metadata(&path) {
                                Ok(metadata) => {
                                    if metadata.permissions().mode() & 0o111 == 0 {
                                        continue;
                                    }
                                }
                                Err(_) => continue,
                            }
                        }

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
                        if is_placeholder_name(dir_name) {
                            continue;
                        }
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

pub fn sidecar_candidates(project_root: &PathBuf, app: &tauri::App) -> Vec<PathBuf> {
    let mut out = Vec::new();
    let mut seen: HashSet<PathBuf> = HashSet::new();
    let binary_name = sidecar_binary_name();

    let mut push_candidate = |path: PathBuf| {
        if seen.insert(path.clone()) {
            out.push(path);
        }
    };

    if let Ok(executable_dir) = app.path().executable_dir() {
        push_sidecar_name_candidates(&executable_dir, binary_name.as_ref(), &mut push_candidate);
        push_sidecar_onedir_candidates(&executable_dir, binary_name.as_ref(), &mut push_candidate);
        push_sidecar_scan_candidates(&executable_dir, &mut push_candidate);
    }

    if let Ok(resource_dir) = app.path().resource_dir() {
        push_sidecar_name_candidates(&resource_dir, binary_name.as_ref(), &mut push_candidate);
        push_sidecar_onedir_candidates(&resource_dir, binary_name.as_ref(), &mut push_candidate);
        push_sidecar_scan_candidates(&resource_dir, &mut push_candidate);

        if let Some(bundle_root) = macos_bundle_root_from_resources_dir(&resource_dir) {
            let contents_dir = bundle_root.join("Contents");
            let macos_dir = contents_dir.join("MacOS");
            push_sidecar_name_candidates(&macos_dir, binary_name.as_ref(), &mut push_candidate);
            push_sidecar_onedir_candidates(&macos_dir, binary_name.as_ref(), &mut push_candidate);
            push_sidecar_scan_candidates(&macos_dir, &mut push_candidate);
        }
    }

    if let Ok(current_exe) = env::current_exe() {
        if let Some(executable_dir) = current_exe.parent() {
            let executable_dir = executable_dir.to_path_buf();
            push_sidecar_name_candidates(&executable_dir, binary_name.as_ref(), &mut push_candidate);
            push_sidecar_onedir_candidates(&executable_dir, binary_name.as_ref(), &mut push_candidate);
            push_sidecar_scan_candidates(&executable_dir, &mut push_candidate);
        }

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

    if cfg!(debug_assertions) {
        let dev_binaries_dir = project_root.join("src-tauri").join("binaries");
        if let Some(binary_name) = binary_name.as_ref() {
            for candidate in with_executable_variants(dev_binaries_dir.join(binary_name)) {
                push_candidate(candidate);
            }
            for candidate in with_executable_variants(dev_binaries_dir.join(binary_name).join(binary_name)) {
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
