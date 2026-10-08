#!/usr/bin/env node
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'

import { runCommand } from './lib/commands.mjs'
import { createPyInstallerArgs } from './lib/pyinstallerConfig.mjs'
import { scriptProjectRootFrom } from './lib/projectPaths.mjs'
import { deduplicateTensorFlowBinary } from './lib/sidecarBundle.mjs'
import { RUNTIMES, runtimePython, executable } from './lib/runtimes.mjs'

const root = scriptProjectRootFrom(import.meta.url)
process.chdir(root)
try {
  for (const [role, runtime] of Object.entries(RUNTIMES)) {
    const python = runtimePython(root, role)
    const directory = path.dirname(executable(root, role))
    rmSync(directory, { recursive: true, force: true })
    mkdirSync(directory, { recursive: true })
    let model = ''
    if (role === 'segmenter') {
      model = runCommand(python, ['-c',
        'from pathlib import Path; import kraken; print(Path(kraken.__file__).parent / "blla.mlmodel")'
      ]).stdout.trim()
      if (!existsSync(model)) throw new Error(`Missing Kraken default model: ${model}`)
    }
    console.log(`Building ${role} from ${python}`)
    runCommand(python, ['-m', 'PyInstaller', ...createPyInstallerArgs(root, role, model)], { stdio: 'inherit' })
    if (role === 'recognizer') deduplicateTensorFlowBinary(directory)
    runCommand(executable(root, role), ['--help'])
    writeFileSync(path.join(directory, '.gitkeep'), '')
  }
  // Real inference and sibling-runtime discovery, not just an import/--help check.
  runCommand(runtimePython(root, 'backend'), ['scripts/smoke_workers.py'], { stdio: 'inherit' })
} catch (error) {
  console.error(String(error?.message || error))
  process.exit(1)
}
