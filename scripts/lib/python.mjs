import { commandExists, tryCommand } from './commands.mjs'

const DEFAULT_MACOS_PYTHON =
  '/Users/matthew/personal-projects/fraktur/mimir-venv/venv/bin/python'

function pythonCandidates() {
  const candidates = []
  const configuredPython = String(process.env.MIMIR_PYTHON || '').trim()

  if (configuredPython) {
    candidates.push({
      command: configuredPython,
      prefixArgs: [],
      source: 'MIMIR_PYTHON',
    })
  }

  if (process.platform === 'darwin') {
    candidates.push({
      command: DEFAULT_MACOS_PYTHON,
      prefixArgs: [],
      source: 'macOS development venv',
    })
  }

  candidates.push({
    command: process.platform === 'win32' ? 'python' : 'python3',
    prefixArgs: [],
    source: 'platform PATH',
  })

  return candidates
}

export function resolvePython(_rootDir) {
  for (const candidate of pythonCandidates()) {
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
