#!/usr/bin/env node
import { spawnSync } from 'node:child_process'
import { chmodSync, existsSync, mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

function detectTargetTriple() {
  const result = spawnSync('rustc', ['-vV'], {
    cwd: ROOT_DIR,
    stdio: 'pipe',
    encoding: 'utf8',
    shell: false,
  })

  if (result.status !== 0) {
    return ''
  }

  const hostLine = (result.stdout || '')
    .split(/\r?\n/)
    .find((line) => line.toLowerCase().startsWith('host:'))

  return hostLine?.split(':')[1]?.trim() || ''
}

function ensureDevStub() {
  const triple = detectTargetTriple()
  if (!triple) {
    console.warn('Could not detect rustc target triple; skipping dev sidecar stub creation.')
    return
  }

  const outDir = path.join(ROOT_DIR, 'src-tauri', 'binaries')
  const sidecarPath = path.join(outDir, `backend-${triple}`)

  if (existsSync(sidecarPath)) {
    return
  }

  mkdirSync(outDir, { recursive: true })

  const stub = [
    '#!/usr/bin/env bash',
    'echo "Mimir dev sidecar stub: using Python backend fallback." >&2',
    'exit 1',
    '',
  ].join('\n')

  writeFileSync(sidecarPath, stub, 'utf8')

  if (process.platform !== 'win32') {
    chmodSync(sidecarPath, 0o755)
  }

  console.log(`Created dev sidecar stub at ${sidecarPath}`)
}

ensureDevStub()
