#!/usr/bin/env node
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'

import { scriptProjectRootFrom } from './lib/projectPaths.mjs'

const ROOT_DIR = scriptProjectRootFrom(import.meta.url)
const LEGACY_BINARIES_DIR = path.join(ROOT_DIR, 'src-tauri', 'binaries')
const SIDECAR_RUNTIME_DIR = path.join(
  ROOT_DIR,
  'src-tauri',
  'resources',
  'backend-runtime',
)

function main() {
  rmSync(LEGACY_BINARIES_DIR, { recursive: true, force: true })
  rmSync(SIDECAR_RUNTIME_DIR, { recursive: true, force: true })

  mkdirSync(SIDECAR_RUNTIME_DIR, { recursive: true })
  writeFileSync(path.join(SIDECAR_RUNTIME_DIR, '.gitkeep'), '', 'utf8')

  console.log('Removed stale sidecar artifacts and reset backend resources.')
}

main()
