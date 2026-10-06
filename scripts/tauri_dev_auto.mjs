#!/usr/bin/env node
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { scriptProjectRootFrom } from './lib/projectPaths.mjs'
import { RUNTIMES, runtimePython } from './lib/runtimes.mjs'

const root = scriptProjectRootFrom(import.meta.url)
const env = { ...process.env }
for (const role of Object.keys(RUNTIMES)) {
  const python = runtimePython(root, role)
  if (!existsSync(python)) throw new Error(`Missing ${python}; run yarn backend:setup first`)
  env[role === 'backend' ? 'MIMIR_PYTHON' : `MIMIR_${role.toUpperCase()}_PYTHON`] = python
}
const child = spawn(process.execPath, [path.join(root, 'node_modules/@tauri-apps/cli/tauri.js'), 'dev', ...process.argv.slice(2)],
  { cwd: root, env, stdio: 'inherit' })
child.on('error', error => { console.error(error); process.exitCode = 1 })
child.on('exit', code => { process.exitCode = code ?? 1 })
