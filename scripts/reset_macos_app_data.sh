#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

APP_NAME="MimirOCR"
APP_IDENTIFIER="io.mrogness.mimirocr"

LOCAL_DATA_DIR="$REPO_ROOT/backend/data"
LOCAL_CACHE_DIR="$REPO_ROOT/backend/output"
LOCAL_TEMP_DIR="$REPO_ROOT/backend/tmp"

# Tauri-managed runtime folders used by packaged builds.
APP_SUPPORT_CANDIDATES=(
  "$HOME/Library/Application Support/$APP_IDENTIFIER/backend"
  "$HOME/Library/Application Support/$APP_NAME/backend"
)

CACHE_CANDIDATES=(
  "$HOME/Library/Caches/$APP_IDENTIFIER/backend"
  "$HOME/Library/Caches/$APP_NAME/backend"
)

LOG_CANDIDATES=(
  "$HOME/Library/Logs/$APP_IDENTIFIER"
  "$HOME/Library/Logs/$APP_NAME"
)

STATE_CANDIDATES=(
  "$HOME/Library/Saved Application State/$APP_IDENTIFIER.savedState"
  "$HOME/Library/Saved Application State/$APP_NAME.savedState"
)

if [[ "${1:-}" == "--help" || "${1:-}" == "-h" ]]; then
  cat <<'EOF'
Delete all local Mimir app data so the next launch behaves like a fresh install.

Usage:
  ./scripts/reset_macos_app_data.sh

What it removes:
  - backend/data (including app_data.db and uploads)
  - backend/output
  - backend/tmp
  - ~/Library/Application Support/{io.mrogness.mimirocr,MimirOCR}/backend
  - ~/Library/Caches/{io.mrogness.mimirocr,MimirOCR}/backend
  - ~/Library/Logs/{io.mrogness.mimirocr,MimirOCR}
  - ~/Library/Saved Application State/{io.mrogness.mimirocr,MimirOCR}.savedState

What it recreates:
  - backend/data/uploads
  - backend/output/output
  - backend/tmp
EOF
  exit 0
fi

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "This script is intended for macOS only."
  exit 1
fi

paths_to_delete=(
  "$LOCAL_DATA_DIR"
  "$LOCAL_CACHE_DIR"
  "$LOCAL_TEMP_DIR"
)

paths_to_delete+=("${APP_SUPPORT_CANDIDATES[@]}")
paths_to_delete+=("${CACHE_CANDIDATES[@]}")
paths_to_delete+=("${LOG_CANDIDATES[@]}")
paths_to_delete+=("${STATE_CANDIDATES[@]}")

echo "Resetting Mimir data to a clean state..."

for path in "${paths_to_delete[@]}"; do
  if [[ -z "$path" || "$path" == "/" ]]; then
    echo "Skipping unsafe path: '$path'"
    continue
  fi

  if [[ -e "$path" ]]; then
    rm -rf "$path"
    echo "Deleted: $path"
  else
    echo "Not found (skipped): $path"
  fi
done

mkdir -p "$LOCAL_DATA_DIR/uploads"
mkdir -p "$LOCAL_CACHE_DIR/output"
mkdir -p "$LOCAL_TEMP_DIR"

echo ""
echo "Fresh local state is ready."
echo "Recreated:"
echo "  - $LOCAL_DATA_DIR/uploads"
echo "  - $LOCAL_CACHE_DIR/output"
echo "  - $LOCAL_TEMP_DIR"
