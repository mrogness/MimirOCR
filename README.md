# Tauri + Vue 3

This template should help get you started developing with Tauri + Vue 3 in Vite. The template uses Vue 3 `<script setup>` SFCs, check out the [script setup docs](https://v3.vuejs.org/api/sfc-script-setup.html#sfc-script-setup) to learn more.

## Recommended IDE Setup

- [VS Code](https://code.visualstudio.com/) + [Vue - Official](https://marketplace.visualstudio.com/items?itemName=Vue.volar) + [Tauri](https://marketplace.visualstudio.com/items?itemName=tauri-apps.tauri-vscode) + [rust-analyzer](https://marketplace.visualstudio.com/items?itemName=rust-lang.rust-analyzer)

## Packaging Installer with Backend Sidecar

This app can bundle the Python FastAPI backend as a sidecar executable so end users do not need Python installed.

### 1) Build installer (sidecar + Tauri bundle)

Use the one-shot packaging script:

```bash
yarn package
```

This runs sidecar preflight checks, sidecar build, and then `tauri build`.

Before running it on a new machine, install backend dependencies:

```bash
python -m pip install -r requirements.txt
```

### 2) Build only the backend sidecar (optional)

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

### 3) Build the installer manually (optional)

```bash
yarn tauri build
```

Installer artifacts will be placed under `src-tauri/target/release/bundle/`.

### macOS user-level install (no admin password)

For arm64 macOS app bundles, use:

```bash
yarn package:mac:app
```

This creates:

- `src-tauri/target/release/bundle/macos/Mimir.app.zip`
- `src-tauri/target/release/bundle/macos/Install Mimir to Home Applications.command`

Run the generated `.command` file to install into `~/Applications` (user-level), which avoids admin prompts from writing to `/Applications`.

### 4) Windows build machine setup (recommended)

On a Windows machine, install these once:

- Node.js LTS (20+)
- Rust toolchain (stable, MSVC target)
- Visual Studio 2022 Build Tools with Desktop C++ workload + Windows SDK
- Python 3.10+ (on PATH)

On a brand-new Windows machine, run the bootstrap helper directly from PowerShell (this does not require Node or Yarn to already be installed):

```powershell
powershell -ExecutionPolicy Bypass -File scripts/bootstrap_windows_packaging.ps1
```

Or from Command Prompt:

```cmd
scripts\\bootstrap_windows_packaging.cmd
```

After Node + Yarn are installed by bootstrap, you can also use the yarn alias:

```powershell
yarn bootstrap:windows
```

The bootstrap script first checks existing installations and versions, uninstalls mismatched tool versions, and then installs the required versions.

By default, this enforces exact tool versions to mirror this build setup:

- Python `3.8.20`
- Node `22.19.0`
- Yarn `1.22.22`
- Rust `1.96.0`

To override the Python command/version explicitly:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/bootstrap_windows_packaging.ps1 -PythonCommand py -RequiredPythonVersion 3.8.20
```

To skip strict version matching:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/bootstrap_windows_packaging.ps1 -NoVersionEnforcement
```

This script:

- checks required tools (`node`, `yarn`, `python`, `rustc`, `cargo`)
- removes existing mismatched Node/Yarn/Python/Rust installations before reinstalling required versions
- installs missing/mismatched tools automatically on Windows (Node, Python, Rust/rustup, Visual C++ Build Tools)
- creates `.venv` if needed
- installs `requirements.txt` into `.venv`
- runs `yarn install`
- runs `yarn sidecar:preflight`

If you want check-only mode (no installs), run:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/bootstrap_windows_packaging.ps1 -SkipToolInstall
```

After bootstrap, package with:

```powershell
yarn package
```

Optional profiles:

```powershell
yarn package:lean
yarn package:aggressive
```

### 5) Manual one-block Windows setup (exact versions)

If you prefer to install everything manually from command line on a fresh Windows machine, run this in **PowerShell as Administrator**:

```powershell
$ErrorActionPreference = 'Stop'

# Exact versions required for this project bootstrap flow.
$nodeVersion = '22.19.0'
$yarnVersion = '1.22.22'
$pythonVersion = '3.8.20'
$rustVersion = '1.96.0'

Write-Host '--- Optional cleanup of conflicting installs ---' -ForegroundColor Cyan
try {
	if (Get-Command nvm -ErrorAction SilentlyContinue) {
		$nvmList = nvm list 2>$null
		foreach ($line in $nvmList) {
			$matches = [regex]::Matches([string]$line, '\d+\.\d+\.\d+')
			foreach ($m in $matches) { nvm uninstall $m.Value | Out-Host }
		}
		nvm off | Out-Host
	}
} catch {}

try { npm uninstall -g yarn | Out-Host } catch {}

Write-Host '--- Install Node ---' -ForegroundColor Cyan
$nodeMsi = "$env:TEMP\node-v$nodeVersion-x64.msi"
Invoke-WebRequest "https://nodejs.org/dist/v$nodeVersion/node-v$nodeVersion-x64.msi" -OutFile $nodeMsi
Start-Process msiexec.exe -Wait -ArgumentList "/i `"$nodeMsi`" /qn /norestart MSIINSTALLPERUSER=1 ALLUSERS=2"

Write-Host '--- Install Yarn via Corepack ---' -ForegroundColor Cyan
corepack enable
corepack prepare "yarn@$yarnVersion" --activate

Write-Host '--- Install Python ---' -ForegroundColor Cyan
$pyExe = "$env:TEMP\python-$pythonVersion-amd64.exe"
Invoke-WebRequest "https://www.python.org/ftp/python/$pythonVersion/python-$pythonVersion-amd64.exe" -OutFile $pyExe
Start-Process $pyExe -Wait -ArgumentList "/quiet InstallAllUsers=0 PrependPath=1 Include_test=0 SimpleInstall=1"

Write-Host '--- Install Rust ---' -ForegroundColor Cyan
$rustupExe = "$env:TEMP\rustup-init.exe"
Invoke-WebRequest "https://static.rust-lang.org/rustup/dist/x86_64-pc-windows-msvc/rustup-init.exe" -OutFile $rustupExe
Start-Process $rustupExe -Wait -ArgumentList "-y --profile minimal --default-toolchain $rustVersion"
rustup default $rustVersion

Write-Host '--- Install Visual C++ Build Tools ---' -ForegroundColor Cyan
$vsExe = "$env:TEMP\vs_BuildTools.exe"
Invoke-WebRequest "https://aka.ms/vs/17/release/vs_BuildTools.exe" -OutFile $vsExe
Start-Process $vsExe -Wait -ArgumentList "--quiet --wait --norestart --nocache --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended --includeOptional"

Write-Host '--- Refresh PATH in this shell ---' -ForegroundColor Cyan
$env:Path = [System.Environment]::GetEnvironmentVariable('Path','Machine') + ';' + [System.Environment]::GetEnvironmentVariable('Path','User')

Write-Host '--- Verify installed versions ---' -ForegroundColor Cyan
node -v
yarn -v
python --version
rustc --version
cargo --version
where node

Write-Host '--- Project setup and packaging ---' -ForegroundColor Cyan
# Change this path to your local clone location on Windows.
Set-Location 'C:\path\to\Mimir'

python -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
python -m pip install -r requirements.txt
yarn install
yarn sidecar:preflight
yarn package
```

### Notes

- `src-tauri/tauri.conf.json` uses a reverse-DNS identifier (`io.mrogness.mimir`) and includes `bundle.resources` for `binaries/backend-*` to package sidecar onedir bundles.
- At runtime, Tauri now tries the sidecar first, and falls back to Python+uvicorn if needed.
- The sidecar build is cross-platform via `scripts/build_backend_sidecar.mjs`.
- macOS sidecar launch no longer executes from cache extraction; it runs from the bundled onedir payload in app resources.
- Preflight validation is available via `yarn sidecar:preflight`.
