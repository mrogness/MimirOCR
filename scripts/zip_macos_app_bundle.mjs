#!/usr/bin/env node
import { chmodSync, existsSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const macosBundleDir = path.join(rootDir, 'src-tauri', 'target', 'release', 'bundle', 'macos')

if (process.platform !== 'darwin') {
  console.error('zip_macos_app_bundle.mjs must be run on macOS')
  process.exit(1)
}

function run(command, args) {
  const result = spawnSync(command, args, { stdio: 'inherit' })
  if (result.error) {
    throw result.error
  }
  if (result.status !== 0) {
    throw new Error(`${command} exited with code ${result.status}`)
  }
}

function resolveDittoCommand() {
  if (existsSync('/usr/bin/ditto')) {
    return '/usr/bin/ditto'
  }

  const whichResult = spawnSync('which', ['ditto'], { stdio: 'pipe', encoding: 'utf8', shell: false })
  if (whichResult.status === 0) {
    const located = String(whichResult.stdout || '').trim()
    if (located) {
      return located
    }
  }

  return 'ditto'
}

const dittoCommand = resolveDittoCommand()

const entries = readdirSync(macosBundleDir)
const appCandidates = entries
  .filter((entry) => entry.endsWith('.app'))
  .map((entry) => path.join(macosBundleDir, entry))
  .filter((candidate) => statSync(candidate).isDirectory())

if (appCandidates.length === 0) {
  console.error(`No .app bundle found in ${macosBundleDir}`)
  process.exit(1)
}

for (const appPath of appCandidates) {
  const appZipPath = `${appPath}.zip`
  const appName = path.basename(appPath)
  const appBaseName = appName.replace(/\.app$/i, '')
  const installScriptPath = path.join(macosBundleDir, `Install ${appBaseName} to Home Applications.command`)
  try {
    run(dittoCommand, ['-c', '-k', '--sequesterRsrc', '--keepParent', appPath, appZipPath])
  } catch (error) {
    const message = String(error?.message || error)
    if (message.includes('ENOENT')) {
      console.error('ditto command is required to archive .app bundles')
      process.exit(1)
    }

    throw error
  }

  const installScript = [
    '#!/usr/bin/env bash',
    'set -euo pipefail',
    '',
    'SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"',
    `APP_NAME="${appName}"`,
    `APP_ZIP_NAME="${path.basename(appZipPath)}"`,
    'APP_DIR="$SCRIPT_DIR/$APP_NAME"',
    'APP_ZIP="$SCRIPT_DIR/$APP_ZIP_NAME"',
    'HOME_APPS_DIR="$HOME/Applications"',
    'TARGET_APP="$HOME_APPS_DIR/$APP_NAME"',
    '',
    'mkdir -p "$HOME_APPS_DIR"',
    '',
    'if [ ! -d "$APP_DIR" ]; then',
    '  if [ ! -f "$APP_ZIP" ]; then',
    '    echo "Missing app archive: $APP_ZIP" >&2',
    '    exit 1',
    '  fi',
    '  /usr/bin/ditto -x -k "$APP_ZIP" "$SCRIPT_DIR"',
    'fi',
    '',
    'rm -rf "$TARGET_APP"',
    '/usr/bin/ditto "$APP_DIR" "$TARGET_APP"',
    '/usr/bin/xattr -dr com.apple.quarantine "$TARGET_APP" >/dev/null 2>&1 || true',
    '/usr/bin/open "$TARGET_APP"',
    'echo "Installed $APP_NAME to $TARGET_APP"',
    '',
  ].join('\n')

  writeFileSync(installScriptPath, installScript, 'utf8')
  chmodSync(installScriptPath, 0o755)
  console.log(`Created ${appZipPath}`)
  console.log(`Created ${installScriptPath}`)
}
