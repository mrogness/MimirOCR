import path from 'node:path'

import { commandExists, tryCommand } from './commands.mjs'

function pythonCandidates(rootDir) {
  const localVenvCandidates = process.platform === 'win32'
    ? [
        path.join(rootDir, '.venv', 'Scripts', 'python.exe'),
        path.join(rootDir, 'venv', 'Scripts', 'python.exe'),
      ]
    : [
        path.join(rootDir, '.venv', 'bin', 'python'),
        path.join(rootDir, 'venv', 'bin', 'python'),
      ]

  return [
    ...localVenvCandidates.map((command) => ({
      command,
      prefixArgs: [],
      source: 'local-venv',
    })),
    { command: 'python', prefixArgs: [], source: 'PATH' },
    { command: 'python3', prefixArgs: [], source: 'PATH' },
    { command: 'py', prefixArgs: ['-3'], source: 'PATH' },
  ]
}

export function resolvePython(rootDir) {
  for (const candidate of pythonCandidates(rootDir)) {
    if (commandExists(candidate.command, [...candidate.prefixArgs, '--version'])) {
      return candidate
    }
  }

  return null
}

export function runPython(python, args, options = {}) {
  return tryCommand(
    python.command,
    [...python.prefixArgs, ...args],
    options,
  )
}

export function getPythonExecutable(python) {
  const result = runPython(python, ['-c', 'import sys; print(sys.executable)'])
  return result ? String(result.stdout || '').trim() || null : null
}

export function resolvePyInstaller(python) {
  if (commandExists('pyinstaller', ['--version'])) {
    return { command: 'pyinstaller', prefixArgs: [] }
  }

  if (!python) {
    return null
  }

  const result = runPython(python, ['-m', 'PyInstaller', '--version'])
  if (!result) {
    return null
  }

  return {
    command: python.command,
    prefixArgs: [...python.prefixArgs, '-m', 'PyInstaller'],
  }
}
