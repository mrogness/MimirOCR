Copyright (C) 2026 Matthew Rogness
# Tauri + Vue 3

This template should help get you started developing with Tauri + Vue 3 in Vite. The template uses Vue 3 `<script setup>` SFCs, check out the [script setup docs](https://v3.vuejs.org/api/sfc-script-setup.html#sfc-script-setup) to learn more.

## Recommended IDE Setup

- [VS Code](https://code.visualstudio.com/) + [Vue - Official](https://marketplace.visualstudio.com/items?itemName=Vue.volar) + [Tauri](https://marketplace.visualstudio.com/items?itemName=tauri-apps.tauri-vscode) + [rust-analyzer](https://marketplace.visualstudio.com/items?itemName=rust-lang.rust-analyzer)

## Packaging Installer with Backend Sidecar

This app can bundle the Python FastAPI backend as a sidecar executable so end users do not need Python installed.

### Local packaging commands

Build all platform-default bundles on the current machine:

```bash
yarn package
```

Build macOS artifacts (`.app`, `.dmg`, plus `.app.zip` and Home Applications installer helper):

```bash
yarn package:mac
```

Build Windows artifacts (NSIS installer):

```bash
yarn package:windows
```

Before running it on a new machine, install backend dependencies:

```bash
python -m pip install -r requirements.txt
```

For sidecar packaging workflows (local/CI), dependencies are installed from:

`requirements-sidecar.txt`

### Build only the backend sidecar (optional)

Install PyInstaller in your active Python environment:

```bash
pip install pyinstaller
```

Build the sidecar bundle (named for your Rust host target triple):

```bash
yarn build:sidecar
```

This creates an onedir bundle under `src-tauri/binaries/`, for example:

`src-tauri/binaries/backend-aarch64-apple-darwin/`

with executable:

`src-tauri/binaries/backend-aarch64-apple-darwin/backend-aarch64-apple-darwin`

### macOS user-level install (no admin password)

`yarn package:mac` creates:

- `src-tauri/target/release/bundle/macos/Mimir.app.zip`
- `src-tauri/target/release/bundle/macos/Mimir.app.dmg`
- `src-tauri/target/release/bundle/macos/Install Mimir to Home Applications.command`

Run the generated `.command` file to install into `~/Applications` (user-level), which avoids admin prompts from writing to `/Applications`.

### GitHub Actions builds

CI builds are defined in `.github/workflows/build-artifacts.yml` and produce:

- macOS: `.app.zip` and `.dmg`
- Windows: NSIS installer (`.exe`)

Trigger modes:

- push to `main`
- tags like `v1.2.3`
- manual dispatch

### Create and publish a release tag

Use one command to bump versions in app manifests, commit, create an annotated tag, and push:

```bash
yarn release:tag 0.1.1
```

This updates:

- `package.json`
- `src-tauri/tauri.conf.json`
- `src-tauri/Cargo.toml`

and then creates/pushes tag `v0.1.1`, which triggers CI release upload.

Optional dry-run style (no push):

```bash
yarn release:tag 0.1.1 --no-push
```

### Unsigned distribution behavior (important)

This project currently does not use paid code signing certificates.

- macOS: users should expect Gatekeeper warnings for unsigned apps.
- Windows: users should expect SmartScreen warnings for unsigned installers.

These warnings are expected until signing/notarization is added.

When downloading macOS artifacts from CI, use the `.app.zip` or `.dmg`. Do not run a raw `.app` copied out of an artifact browser/download flow, because hidden sidecar files can be dropped and macOS will report the app as damaged.

### Minimal manual Tauri build (optional)

```bash
yarn tauri build
```

Installer artifacts will be placed under `src-tauri/target/release/bundle/`.

### Notes

- `src-tauri/tauri.conf.json` uses a reverse-DNS identifier (`io.mrogness.mimir`) and includes `bundle.resources` for `binaries/backend-*` to package sidecar onedir bundles.
- At runtime, Tauri now tries the sidecar first, and falls back to Python+uvicorn if needed.
- The sidecar build is cross-platform via `scripts/build_backend_sidecar.mjs`.
- CI packaging uses `requirements-sidecar.txt` (not full `requirements.txt`) to avoid platform-specific dependency resolution issues during sidecar builds.
- macOS sidecar launch no longer executes from cache extraction; it runs from the bundled onedir payload in app resources.
- Preflight validation is available via `yarn sidecar:preflight`.
