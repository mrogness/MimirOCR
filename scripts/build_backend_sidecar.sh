#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR"

PROFILE="${1:-${MIMIR_SIDECAR_PROFILE:-standard}}"
PROFILE="$(printf '%s' "$PROFILE" | tr '[:upper:]' '[:lower:]')"

if [[ "$PROFILE" != "standard" && "$PROFILE" != "lean" && "$PROFILE" != "aggressive" ]]; then
  echo "Unsupported sidecar profile '$PROFILE'. Use 'standard', 'lean', or 'aggressive'."
  exit 1
fi

if ! command -v rustc >/dev/null 2>&1; then
  echo "rustc is required to detect target triple"
  exit 1
fi

if ! command -v pyinstaller >/dev/null 2>&1; then
  echo "pyinstaller is required. Install with: pip install pyinstaller"
  exit 1
fi

TARGET_TRIPLE="$(rustc -vV | awk '/host:/ {print $2}')"
if [[ -z "$TARGET_TRIPLE" ]]; then
  echo "Unable to detect Rust host target triple"
  exit 1
fi

OUT_DIR="src-tauri/binaries"
BIN_NAME="backend-${TARGET_TRIPLE}"

mkdir -p "$OUT_DIR"

PYINSTALLER_PROFILE_ARGS=()
if [[ "$PROFILE" == "lean" || "$PROFILE" == "aggressive" ]]; then
  PYINSTALLER_PROFILE_ARGS+=(--strip)
  for MOD in \
    cv2 \
    matplotlib \
    matplotlib.pyplot \
    IPython \
    ipykernel \
    jupyter_client \
    jupyter_core \
    debugpy \
    pandas \
    openpyxl \
    xlsxwriter \
    tkinter
  do
    PYINSTALLER_PROFILE_ARGS+=(--exclude-module "$MOD")
  done

  if [[ "$PROFILE" == "aggressive" ]]; then
    for MOD in \
      torchmetrics \
      pytorch_lightning \
      tensorboard \
      tensorboard_data_server \
      tensorboard_plugin_wit \
      tensorflow_estimator \
      tensorflow.compiler.tf2tensorrt \
      tensorflow.lite \
      tensorflow.python.profiler \
      tensorflow.python.data.experimental.service
    do
      PYINSTALLER_PROFILE_ARGS+=(--exclude-module "$MOD")
    done
  fi
fi

echo "Building sidecar with profile: $PROFILE"

pyinstaller \
  --noconfirm \
  --clean \
  --onefile \
  --paths "$ROOT_DIR" \
  --collect-submodules backend \
  --name "$BIN_NAME" \
  --distpath "$OUT_DIR" \
  --workpath "$ROOT_DIR/.pyinstaller/build" \
  --specpath "$ROOT_DIR/.pyinstaller/spec" \
  "${PYINSTALLER_PROFILE_ARGS[@]}" \
  backend/sidecar_main.py

chmod +x "$OUT_DIR/$BIN_NAME"

# The sidecar imports backend modules at process startup, so a --help run
# catches missing bundled imports before we ship an installer.
"$OUT_DIR/$BIN_NAME" --help >/dev/null

if [[ "$(uname -s)" == "Darwin" ]]; then
  CODESIGN_CMD=(codesign)
  if ! command -v codesign >/dev/null 2>&1; then
    if command -v xcrun >/dev/null 2>&1 && xcrun -f codesign >/dev/null 2>&1; then
      CODESIGN_CMD=(xcrun codesign)
    else
      echo "codesign is required on macOS to sign the sidecar binary"
      exit 1
    fi
  fi

  "${CODESIGN_CMD[@]}" --force --sign - --timestamp=none --verbose "$OUT_DIR/$BIN_NAME"
  "${CODESIGN_CMD[@]}" --verify --verbose "$OUT_DIR/$BIN_NAME"
fi

echo "Built sidecar: $OUT_DIR/$BIN_NAME (profile: $PROFILE)"
