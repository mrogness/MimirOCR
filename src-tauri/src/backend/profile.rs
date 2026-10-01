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

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};

    static NEXT_DIRECTORY: AtomicUsize = AtomicUsize::new(0);

    // No new dependency is needed for these isolated filesystem tests. Every test
    // gets a uniquely created directory, removed on drop even after an assertion.
    struct TestRuntime(BackendRuntimePaths);

    impl TestRuntime {
        fn new() -> Self {
            let root = std::env::temp_dir().join(format!(
                "mimir-profile-test-{}-{}-{}",
                std::process::id(),
                std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .unwrap()
                    .as_nanos(),
                NEXT_DIRECTORY.fetch_add(1, Ordering::Relaxed),
            ));
            fs::create_dir(&root).unwrap();
            Self(BackendRuntimePaths {
                app_data_dir: root.clone(),
                cache_dir: root.join("cache"),
                temp_dir: root.join("tmp"),
            })
        }

        fn reservation(&self, token: &str, profile: &str, expires: u64) -> PathBuf {
            let path = self.0.app_data_dir.join(RESTART_RESERVATION_FILE);
            fs::write(&path, serde_json::to_vec(&serde_json::json!({
                "restart_token": token,
                "profile": profile,
                "expires_unix_seconds": expires,
            })).unwrap()).unwrap();
            path
        }
    }

    impl Drop for TestRuntime {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0.app_data_dir);
        }
    }

    #[test]
    fn missing_corrupt_and_unknown_settings_use_balanced() {
        let runtime = TestRuntime::new();
        assert_eq!(load_profile(&runtime.0).as_str(), "balanced");
        for contents in ["not json", r#"{"performance_profile":"turbo"}"#, "{}"] {
            fs::write(settings_path(&runtime.0), contents).unwrap();
            assert_eq!(load_profile(&runtime.0).as_str(), "balanced");
        }
    }

    #[test]
    fn saving_profiles_replaces_settings_and_leaves_no_temporary_file() {
        let runtime = TestRuntime::new();
        for profile in [PerformanceProfile::Cool, PerformanceProfile::Fast, PerformanceProfile::Balanced] {
            save_profile(&runtime.0, profile).unwrap();
            assert_eq!(load_profile(&runtime.0).as_str(), profile.as_str());
            assert!(!settings_path(&runtime.0).with_extension("json.tmp").exists());
        }
    }

    #[test]
    fn restart_reservations_are_single_use() {
        let runtime = TestRuntime::new();
        let path = runtime.reservation("token", "fast", u64::MAX);
        consume_restart_reservation(&runtime.0, "token", PerformanceProfile::Fast).unwrap();
        assert!(!path.exists());
        assert!(consume_restart_reservation(&runtime.0, "token", PerformanceProfile::Fast).is_err());
    }

    #[test]
    fn wrong_token_or_profile_does_not_consume_reservation() {
        let runtime = TestRuntime::new();
        let path = runtime.reservation("token", "fast", u64::MAX);
        assert!(consume_restart_reservation(&runtime.0, "wrong", PerformanceProfile::Fast).is_err());
        assert!(path.exists());
        assert!(consume_restart_reservation(&runtime.0, "token", PerformanceProfile::Cool).is_err());
        assert!(path.exists());
    }

    #[test]
    fn expired_reservations_are_rejected_and_removed() {
        let runtime = TestRuntime::new();
        let path = runtime.reservation("token", "fast", 0);
        let error = consume_restart_reservation(&runtime.0, "token", PerformanceProfile::Fast).unwrap_err();
        assert!(error.contains("expired"));
        assert!(!path.exists());
    }

    #[test]
    fn malformed_reservation_is_rejected() {
        let runtime = TestRuntime::new();
        fs::write(runtime.0.app_data_dir.join(RESTART_RESERVATION_FILE), "not json").unwrap();
        assert!(consume_restart_reservation(&runtime.0, "token", PerformanceProfile::Fast).is_err());
    }

    #[test]
    fn profile_parse_accepts_supported_values() {
        assert!(matches!(
            PerformanceProfile::parse("cool"),
            Ok(PerformanceProfile::Cool)
        ));
        assert!(matches!(
            PerformanceProfile::parse("  balanced  "),
            Ok(PerformanceProfile::Balanced)
        ));
        assert!(matches!(
            PerformanceProfile::parse("FAST"),
            Ok(PerformanceProfile::Fast)
        ));
    }

    #[test]
    fn profile_parse_rejects_unknown_value() {
        let error = PerformanceProfile::parse("turbo").expect_err("expected parse to fail");
        assert!(error.contains("cool, balanced, or fast"));
    }

    #[test]
    fn profile_as_str_matches_expected_wire_values() {
        assert_eq!(PerformanceProfile::Cool.as_str(), "cool");
        assert_eq!(PerformanceProfile::Balanced.as_str(), "balanced");
        assert_eq!(PerformanceProfile::Fast.as_str(), "fast");
    }
}
