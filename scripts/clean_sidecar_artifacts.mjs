#!/usr/bin/env node
import { existsSync, readdirSync, rmSync } from 'node:fs'
import path from 'node:path'

import { scriptProjectRootFrom } from './lib/projectPaths.mjs'

const ROOT_DIR = scriptProjectRootFrom(import.meta.url)
const BINARIES_DIR = path.join(ROOT_DIR, 'src-tauri', 'binaries')
const KEEP_NAMES = new Set(['.gitkeep', 'backend-sentinel'])

function shouldRemove(name) {
  return !KEEP_NAMES.has(name) && name.startsWith('backend-')
}

function main() {
  if (!existsSync(BINARIES_DIR)) {
    console.log(`No binaries directory found at ${BINARIES_DIR}`)
    return
  }

  const removed = []

  for (const name of readdirSync(BINARIES_DIR)) {
    if (!shouldRemove(name)) {
      continue
    }

    rmSync(path.join(BINARIES_DIR, name), {
      recursive: true,
      force: true,
    })
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
