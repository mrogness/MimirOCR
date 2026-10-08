#!/usr/bin/env node
// Shared local/CI packaging; the three runtimes must already be built.
import { mkdirSync, mkdtempSync, readdirSync, rmSync, symlinkSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { runCommand } from './lib/commands.mjs'
import { scriptProjectRootFrom } from './lib/projectPaths.mjs'
import { deduplicateTensorFlowBinary } from './lib/sidecarBundle.mjs'
import { runtimePython } from './lib/runtimes.mjs'

const root = scriptProjectRootFrom(import.meta.url)
process.chdir(root)
const run = (command, args) => runCommand(command, args, { stdio: 'inherit' })
const tauri = args => run(process.execPath, [path.join(root, 'node_modules/@tauri-apps/cli/tauri.js'), ...args])

try {
  const platform = process.argv[2] || process.platform
  if (platform !== process.platform || !['darwin', 'win32'].includes(platform)) {
    throw new Error('Build macOS packages on macOS and Windows packages on Windows.')
  }
  if (platform === 'win32') {
    tauri(['build', '--bundles', 'nsis'])
  } else {
    tauri(['build', '--bundles', 'app'])
    const bundle = path.join(root, 'src-tauri/target/release/bundle')
    const macos = path.join(bundle, 'macos')
    const apps = readdirSync(macos).filter(name => name.endsWith('.app'))
    if (apps.length !== 1) throw new Error(`Expected one .app in ${macos}, found ${apps.length}`)
    const app = path.join(macos, apps[0])
    const resources = path.join(app, 'Contents/Resources')
    // Tauri's copy may materialize aliases; restore the TF alias in the copied bundle.
    deduplicateTensorFlowBinary(path.join(resources, 'mimir-recognizer'))
    run('xattr', ['-cr', app])
    run('codesign', ['--force', '--deep', '--sign', '-', app])
    run('codesign', ['--verify', '--deep', '--strict', '--verbose=4', app])
    run(runtimePython(root, 'backend'), ['scripts/smoke_workers.py', '--runtime-dir', resources])
    run('ditto', ['-c', '-k', '--sequesterRsrc', '--keepParent', app, `${app}.zip`])
    const dmg = path.join(bundle, 'dmg', 'MimirOCR.dmg')
    mkdirSync(path.dirname(dmg), { recursive: true })
    const staging = mkdtempSync(path.join(os.tmpdir(), 'mimir-dmg-'))
    try {
      run('ditto', [app, path.join(staging, apps[0])])
      symlinkSync('/Applications', path.join(staging, 'Applications'))
      run('hdiutil', ['create', '-volname', 'MimirOCR', '-srcfolder', staging,
        '-format', 'UDZO', '-ov', dmg])
    } finally {
      rmSync(staging, { recursive: true, force: true })
    }
  }
} catch (error) {
  console.error(String(error?.message || error))
  process.exitCode = 1
}
