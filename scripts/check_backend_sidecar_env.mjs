#!/usr/bin/env node
import process from 'node:process'

import { getPythonExecutable, resolvePython } from './lib/python.mjs'
import { runCommand } from './lib/commands.mjs'
import { scriptProjectRootFrom } from './lib/projectPaths.mjs'

const ROOT_DIR = scriptProjectRootFrom(import.meta.url)
process.chdir(ROOT_DIR)

const REQUIRED_IMPORTS = [
  'fastapi',
  'uvicorn',
  'sqlalchemy',
  'pydantic',
  'multipart',
  'typing_extensions',
  'numpy',
  'PIL',
  'fitz',
  'kraken',
  'kraken.blla',
  'calamari_ocr',
  'reportlab',
  'PyInstaller',
]

function checkRequiredImports(python) {
  const checkCode = `
import importlib.util
modules = ${JSON.stringify(REQUIRED_IMPORTS)}
missing = [module for module in modules if importlib.util.find_spec(module) is None]
print('\\n'.join(missing))
`

  const result = runCommand(
    python.command,
    [...python.prefixArgs, '-c', checkCode],
  )

  return String(result.stdout || '')
    .split(/\r?\n/)
    .map((moduleName) => moduleName.trim())
    .filter(Boolean)
}

function main() {
  const python = resolvePython(ROOT_DIR)
  if (!python) {
    throw new Error(
      'No Python interpreter found. Install Python 3 and ensure it is on PATH.',
    )
  }

  const executable = getPythonExecutable(python)
  if (executable) {
    console.log(`Using Python interpreter: ${executable} via ${python.source}`)
  }

  const missing = checkRequiredImports(python)
  if (missing.length === 0) {
    console.log('Sidecar preflight passed.')
    return
  }

  console.error('Sidecar preflight failed. Missing Python modules:')
  for (const moduleName of missing) {
    console.error(`  - ${moduleName}`)
  }

  console.error('Install dependencies with:')
  console.error(
    executable
      ? `  ${executable} -m pip install -r requirements.txt`
      : '  python -m pip install -r requirements.txt',
  )
  process.exit(1)
}

try {
  main()
} catch (error) {
  console.error(String(error?.message || error))
  process.exit(1)
}
