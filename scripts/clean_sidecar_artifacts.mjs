#!/usr/bin/env node
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { scriptProjectRootFrom } from './lib/projectPaths.mjs'
import { RUNTIMES } from './lib/runtimes.mjs'

const root = scriptProjectRootFrom(import.meta.url)
for (const { name } of Object.values(RUNTIMES)) {
  const directory = path.join(root, 'src-tauri/resources', name)
  rmSync(directory, { recursive: true, force: true })
  mkdirSync(directory, { recursive: true })
  writeFileSync(path.join(directory, '.gitkeep'), '')
}
