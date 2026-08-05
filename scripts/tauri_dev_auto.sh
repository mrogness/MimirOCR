#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
DEFAULT_MIMIR_PYTHON="/Users/matthew/personal-projects/fraktur/mimir-venv/venv/bin/python"
export MIMIR_PYTHON="${MIMIR_PYTHON:-$DEFAULT_MIMIR_PYTHON}"

cd "$REPO_ROOT"

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "tauri_dev_auto.sh currently targets macOS only." >&2
  exit 1
fi

if [[ ! -x "$MIMIR_PYTHON" ]]; then
  echo "Mimir development Python is not executable: $MIMIR_PYTHON" >&2
  echo "Set MIMIR_PYTHON to the backend virtual environment interpreter." >&2
  exit 1
fi

if ! "$MIMIR_PYTHON" -c "import uvicorn" >/dev/null 2>&1; then
  echo "The selected Mimir Python environment does not contain uvicorn:" >&2
  echo "  $MIMIR_PYTHON" >&2
  exit 1
fi

echo "Starting Tauri dev with Python backend: $MIMIR_PYTHON"
exec yarn tauri dev
