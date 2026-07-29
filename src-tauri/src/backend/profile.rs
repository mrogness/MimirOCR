use std::fs;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use super::state::BackendRuntimePaths;

const SETTINGS_FILE_NAME: &str = "backend-settings.json";
const RESTART_RESERVATION_FILE: &str = "backend-restart-reservation.json";

#[derive(Clone, Copy, Debug, Deserialize, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum PerformanceProfile {
    Cool,
    Balanced,
    Fast,
}

impl PerformanceProfile {
    pub fn parse(value: &str) -> Result<Self, String> {
        match value.trim().to_ascii_lowercase().as_str() {
            "cool" => Ok(Self::Cool),
            "balanced" => Ok(Self::Balanced),
            "fast" => Ok(Self::Fast),
            _ => Err("Performance profile must be cool, balanced, or fast".to_string()),
        }
    }

    pub fn as_str(self) -> &'static str {
        match self {
            Self::Cool => "cool",
            Self::Balanced => "balanced",
            Self::Fast => "fast",
        }
    }
}

#[derive(Debug, Deserialize, Serialize)]
struct BackendSettings {
    performance_profile: PerformanceProfile,
}

#[derive(Debug, Deserialize)]
struct RestartReservation {
    restart_token: String,
    profile: String,
    expires_unix_seconds: u64,
}

fn settings_path(runtime_paths: &BackendRuntimePaths) -> PathBuf {
    runtime_paths.app_data_dir.join(SETTINGS_FILE_NAME)
}

pub fn load_profile(runtime_paths: &BackendRuntimePaths) -> PerformanceProfile {
    let path = settings_path(runtime_paths);
    let Ok(contents) = fs::read_to_string(path) else {
        return PerformanceProfile::Balanced;
    };
    serde_json::from_str::<BackendSettings>(&contents)
        .map(|settings| settings.performance_profile)
        .unwrap_or(PerformanceProfile::Balanced)
}

pub fn save_profile(
    runtime_paths: &BackendRuntimePaths,
    profile: PerformanceProfile,
) -> Result<(), String> {
    fs::create_dir_all(&runtime_paths.app_data_dir).map_err(|error| error.to_string())?;
    let payload = BackendSettings {
        performance_profile: profile,
    };
    let serialized = serde_json::to_string_pretty(&payload).map_err(|error| error.to_string())?;
    write_atomic(&settings_path(runtime_paths), serialized.as_bytes())
}

fn write_atomic(path: &Path, contents: &[u8]) -> Result<(), String> {
    let temporary = path.with_extension("json.tmp");
    fs::write(&temporary, contents).map_err(|error| error.to_string())?;
    if path.exists() {
        fs::remove_file(path).map_err(|error| error.to_string())?;
    }
    fs::rename(temporary, path).map_err(|error| error.to_string())
}


pub fn consume_restart_reservation(
    runtime_paths: &BackendRuntimePaths,
    restart_token: &str,
    profile: PerformanceProfile,
) -> Result<(), String> {
    use std::time::{SystemTime, UNIX_EPOCH};

    let path = runtime_paths.app_data_dir.join(RESTART_RESERVATION_FILE);
    let contents = fs::read_to_string(&path)
        .map_err(|_| "The backend did not authorize this restart".to_string())?;
    let reservation: RestartReservation =
        serde_json::from_str(&contents).map_err(|error| error.to_string())?;
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|error| error.to_string())?
        .as_secs();

    if reservation.restart_token != restart_token {
        return Err("The backend restart reservation token does not match".to_string());
    }
    if reservation.profile != profile.as_str() {
        return Err("The backend restart reservation was created for a different profile".to_string());
    }
    if now >= reservation.expires_unix_seconds {
        let _ = fs::remove_file(&path);
        return Err("The backend restart reservation expired".to_string());
    }

    fs::remove_file(path).map_err(|error| error.to_string())
}
