import path from 'node:path'

import { commandExists, tryCommand } from './commands.mjs'

const DEFAULT_MACOS_PYTHON =
  '/Users/matthew/personal-projects/fraktur/mimir-venv/venv/bin/python'

function pythonCandidates(rootDir) {
  const candidates = []

  const configuredPython = String(process.env.MIMIR_PYTHON || '').trim()

  if (configuredPython) {
    candidates.push({
      command: configuredPython,
      prefixArgs: [],
      source: 'MIMIR_PYTHON',
    })
  }

  const projectVenvPython =
    process.platform === 'win32'
      ? path.join(rootDir, '.venv', 'Scripts', 'python.exe')
      : path.join(rootDir, '.venv', 'bin', 'python')

  candidates.push({
    command: projectVenvPython,
    prefixArgs: [],
    source: 'project .venv',
  })

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

export function resolvePython(rootDir) {
  for (const candidate of pythonCandidates(rootDir)) {
    if (
      commandExists(candidate.command, [
        ...candidate.prefixArgs,
        '--version',
      ])
    ) {
      return candidate
    }
  }

  return null
}