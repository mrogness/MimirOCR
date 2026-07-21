#!/usr/bin/env node
import { existsSync, readdirSync, rmSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const BINARIES_DIR = path.join(ROOT_DIR, 'src-tauri', 'binaries')

const KEEP_NAMES = new Set([
  '.gitkeep',
  'backend-empty',
  'backend-sentinel',
])

function shouldRemove(name) {
  if (KEEP_NAMES.has(name)) {
    return false
  }

  return name.startsWith('backend-')
}

function main() {
  if (!existsSync(BINARIES_DIR)) {
    console.log(`No binaries directory found at ${BINARIES_DIR}`)
    return
  }

  const entries = readdirSync(BINARIES_DIR)
  const removed = []

  for (const name of entries) {
    if (!shouldRemove(name)) {
      continue
    }

    const targetPath = path.join(BINARIES_DIR, name)
    rmSync(targetPath, { recursive: true, force: true })
    removed.push(name)
  }

  if (removed.length === 0) {
    console.log('No stale sidecar artifacts found.')
    return
  }

  console.log(`Removed ${removed.length} sidecar artifact(s):`)
  for (const name of removed) {
    console.log(`- ${name}`)
  }
}

main()
