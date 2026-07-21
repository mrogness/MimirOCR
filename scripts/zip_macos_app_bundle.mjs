#!/usr/bin/env node
import { existsSync, readdirSync, statSync } from 'node:fs'
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
  console.log(`Created ${appZipPath}`)
}
