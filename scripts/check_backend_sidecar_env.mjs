#!/usr/bin/env node
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
process.chdir(ROOT_DIR)

function tryRun(command, args) {
  const result = spawnSync(command, args, {
    stdio: 'pipe',
    encoding: 'utf8',
    shell: false,
  })

  if (result.error || result.status !== 0) {
    return null
  }

  return result
}

function findPythonCommand() {
  const candidates = []

  if (process.env.MIMIR_PYTHON) {
    candidates.push({ cmd: process.env.MIMIR_PYTHON, args: ['--version'], source: 'MIMIR_PYTHON' })
  }

  if (process.env.PYTHON) {
    candidates.push({ cmd: process.env.PYTHON, args: ['--version'], source: 'PYTHON' })
  }

  if (process.env.VIRTUAL_ENV) {
    const venvPython = process.platform === 'win32'
      ? path.join(process.env.VIRTUAL_ENV, 'Scripts', 'python.exe')
      : path.join(process.env.VIRTUAL_ENV, 'bin', 'python')
    candidates.push({ cmd: venvPython, args: ['--version'], source: 'VIRTUAL_ENV' })
  }

  const localVenvCandidates = process.platform === 'win32'
    ? [
      path.join(ROOT_DIR, '.venv', 'Scripts', 'python.exe'),
      path.join(ROOT_DIR, 'venv', 'Scripts', 'python.exe'),
    ]
    : [
      path.join(ROOT_DIR, '.venv', 'bin', 'python'),
      path.join(ROOT_DIR, 'venv', 'bin', 'python'),
    ]

  for (const venvPython of localVenvCandidates) {
    candidates.push({ cmd: venvPython, args: ['--version'], source: 'local-venv' })
  }

  if (process.env.CONDA_PREFIX) {
    const condaPython = process.platform === 'win32'
      ? path.join(process.env.CONDA_PREFIX, 'python.exe')
      : path.join(process.env.CONDA_PREFIX, 'bin', 'python')
    candidates.push({ cmd: condaPython, args: ['--version'], source: 'CONDA_PREFIX' })
  }

  candidates.push(
    { cmd: 'python', args: ['--version'], source: 'PATH' },
    { cmd: 'python3', args: ['--version'], source: 'PATH' },
    { cmd: 'py', args: ['-3', '--version'], source: 'PATH' },
  )

  for (const candidate of candidates) {
    const result = tryRun(candidate.cmd, candidate.args)
    if (result) {
      return candidate
    }
  }

  return null
}

const python = findPythonCommand()
if (!python) {
  console.error('No Python interpreter found. Install Python 3 and ensure it is on PATH.')
  process.exit(1)
}

function runPython(code) {
  const args = [...(python.cmd === 'py' ? ['-3'] : []), '-c', code]
  return spawnSync(python.cmd, args, {
    stdio: 'pipe',
    encoding: 'utf8',
    shell: false,
  })
}

function getPythonExecutable() {
  const probe = runPython('import sys; print(sys.executable)')
  if (probe.status !== 0) {
    return null
  }
  return (probe.stdout || '').trim() || null
}

const executable = getPythonExecutable()
if (executable) {
  const source = python.source ? ` via ${python.source}` : ''
  console.log(`Using Python interpreter: ${executable}${source}`)
}

const imports = [
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

const checkCode = `
import importlib.util
modules = ${JSON.stringify(imports)}
missing = [m for m in modules if importlib.util.find_spec(m) is None]
print('\\n'.join(missing))
`

const checkResult = runPython(checkCode)
if (checkResult.error) {
  console.error(String(checkResult.error))
  process.exit(1)
}

if (checkResult.status !== 0) {
  const stderr = checkResult.stderr?.trim() || 'Unknown Python error during preflight check'
  console.error(stderr)
  process.exit(checkResult.status || 1)
}

const missing = (checkResult.stdout || '')
  .split(/\r?\n/)
  .map((s) => s.trim())
  .filter(Boolean)

if (missing.length > 0) {
  console.error('Sidecar preflight failed. Missing Python modules:')
  for (const mod of missing) {
    console.error(`  - ${mod}`)
  }
  console.error('Install dependencies with:')
  if (executable) {
    console.error(`  ${executable} -m pip install -r requirements.txt`)
  } else {
    console.error('  python -m pip install -r requirements.txt')
  }
  process.exit(1)
}

console.log('Sidecar preflight passed.')
