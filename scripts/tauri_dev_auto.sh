#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "tauri_dev_auto.sh currently targets macOS only." >&2
  echo "Use your normal dev flow on this platform." >&2
  exec yarn tauri dev
fi

choose_python_cmd() {
  if [[ -x "$REPO_ROOT/.venv/bin/python" ]]; then
    echo "$REPO_ROOT/.venv/bin/python"
    return 0
  fi
  if [[ -x "$REPO_ROOT/venv/bin/python" ]]; then
    echo "$REPO_ROOT/venv/bin/python"
    return 0
  fi
  if command -v python3.10 >/dev/null 2>&1; then
    echo "python3.10"
    return 0
  fi
  if command -v python3 >/dev/null 2>&1; then
    echo "python3"
    return 0
  fi
  if command -v python >/dev/null 2>&1; then
    echo "python"
    return 0
  fi

  return 1
}

if [[ ! -x "$REPO_ROOT/.venv/bin/python" ]]; then
  PY_BOOTSTRAP="$(choose_python_cmd || true)"
  if [[ -z "$PY_BOOTSTRAP" ]]; then
    echo "No Python interpreter found to create .venv." >&2
    exit 1
  fi

  echo "Creating .venv with $PY_BOOTSTRAP"
  "$PY_BOOTSTRAP" -m venv "$REPO_ROOT/.venv"
fi

PYTHON_BIN="$REPO_ROOT/.venv/bin/python"

ensure_sidecar_deps() {
  if yarn sidecar:preflight; then
    return 0
  fi

  echo "Installing sidecar dependencies into .venv..."
  "$PYTHON_BIN" -m pip install --upgrade pip
  "$PYTHON_BIN" -m pip install -r requirements-sidecar-macos.txt
  yarn sidecar:preflight
}

sidecar_artifact_exists() {
  local host
  host="$(rustc -vV | awk '/^host:/{print $2}')"
  [[ -n "$host" ]] || return 1

  [[ -x "$REPO_ROOT/src-tauri/binaries/backend-$host" ]] && [[ -d "$REPO_ROOT/src-tauri/binaries/backend-$host-bundle" ]]
}

ensure_sidecar_deps

if ! sidecar_artifact_exists; then
  echo "Building sidecar..."
  yarn build:sidecar
else
  echo "Using existing sidecar artifacts."
fi

echo "Starting Tauri dev with auto-configured sidecar env..."
exec yarn tauri dev
