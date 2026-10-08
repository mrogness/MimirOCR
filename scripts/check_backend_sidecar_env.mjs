#!/usr/bin/env node
import { runCommand } from './lib/commands.mjs'
import { scriptProjectRootFrom } from './lib/projectPaths.mjs'
import { RUNTIMES, runtimePython } from './lib/runtimes.mjs'

const root = scriptProjectRootFrom(import.meta.url)
try {
  for (const [role, runtime] of Object.entries(RUNTIMES)) {
    const python = runtimePython(root, role)
    console.log(`Checking ${role}: ${python}`)
    runCommand(python, ['-c', `
import importlib.util, sys
assert sys.version_info[:2] == (3, 10), 'Use Python 3.10 for the pinned ML stack'
required = ${JSON.stringify(runtime.imports.concat('PyInstaller'))}
forbidden = ${JSON.stringify(runtime.forbidden)}
missing = [x for x in required if importlib.util.find_spec(x) is None]
unexpected = [x for x in forbidden if importlib.util.find_spec(x) is not None]
assert not missing, f'Missing packages: {missing}'
assert not unexpected, f'Cross-runtime packages installed: {unexpected}; recreate this venv'
`], { stdio: 'inherit' })
    runCommand(python, ['-m', 'pip', 'check'], { stdio: 'inherit' })
  }
} catch (error) {
  console.error(String(error?.message || error))
  console.error('Run yarn backend:setup with Python 3.10; each role requires its own environment.')
  process.exit(1)
}
