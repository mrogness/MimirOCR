#!/usr/bin/env node
// Run in the API environment; TensorFlow and PyTorch stay in their own workers.
import path from 'node:path'
import { mkdirSync } from 'node:fs'
import { runCommand } from './lib/commands.mjs'
import { scriptProjectRootFrom } from './lib/projectPaths.mjs'
import { runtimePython } from './lib/runtimes.mjs'

const root = scriptProjectRootFrom(import.meta.url)
process.chdir(root)
try {
  runCommand(process.execPath, ['scripts/check_backend_sidecar_env.mjs'], { stdio: 'inherit' })
  mkdirSync(path.join(root, 'test-results/ml'), { recursive: true })
  runCommand(runtimePython(root, 'backend'), [
    '-m', 'pytest', '-c', 'pytest-ml.ini', 'tests/ml',
    '--junitxml=test-results/ml/results.xml', ...process.argv.slice(2),
  ], { stdio: 'inherit' })
} catch (error) {
  console.error(String(error?.message || error))
  process.exit(1)
}
