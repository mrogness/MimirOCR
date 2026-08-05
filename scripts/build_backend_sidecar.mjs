#!/usr/bin/env node
import { chmodSync, mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import { runCommand } from './lib/commands.mjs'
import {
  createPyInstallerArgs,
  defaultSidecarProfile,
  validateSidecarProfile,
} from './lib/pyinstallerConfig.mjs'
import {
  getPythonExecutable,
  resolvePyInstaller,
  resolvePython,
  runPython,
} from './lib/python.mjs'
import { scriptProjectRootFrom } from './lib/projectPaths.mjs'
import {
  cleanPathIfExists,
  deduplicateTensorFlowBinary,
  runSidecarSmokeTestWithPolicy,
  sidecarExecutablePath,
  signSidecarIfNeeded,
} from './lib/sidecarBundle.mjs'

const ROOT_DIR = scriptProjectRootFrom(import.meta.url)
const SIDECAR_BUNDLE_NAME = 'backend-runtime'
const SIDECAR_OUTPUT_DIR = path.join('src-tauri', 'resources')
process.chdir(ROOT_DIR)

function resolveKrakenBllaModelPath(python) {
  if (!python) {
    return ''
  }

  const code = [
    'from pathlib import Path',
    'import kraken',
    'p = Path(kraken.__file__).resolve().parent / "blla.mlmodel"',
    'print(str(p) if p.exists() else "")',
  ].join('; ')

  const result = runPython(python, ['-c', code])
  return result ? String(result.stdout || '').trim() : ''
}

function cleanPreviousOutputs() {
  mkdirSync(SIDECAR_OUTPUT_DIR, { recursive: true })
  cleanPathIfExists(path.join(SIDECAR_OUTPUT_DIR, SIDECAR_BUNDLE_NAME))
  cleanPathIfExists(
    path.join(SIDECAR_OUTPUT_DIR, `${SIDECAR_BUNDLE_NAME}.exe`),
  )
}

function finalizeSidecar() {
  const sidecarRootDir = path.join(
    SIDECAR_OUTPUT_DIR,
    SIDECAR_BUNDLE_NAME,
  )
  const executablePath = sidecarExecutablePath(
    SIDECAR_OUTPUT_DIR,
    SIDECAR_BUNDLE_NAME,
  )

  deduplicateTensorFlowBinary(sidecarRootDir)

  if (process.platform !== 'win32') {
    chmodSync(executablePath, 0o755)
  }

  runSidecarSmokeTestWithPolicy(executablePath)
  signSidecarIfNeeded(executablePath)

  // Keep the generated resource directory present in clean source checkouts.
  writeFileSync(path.join(sidecarRootDir, '.gitkeep'), '', 'utf8')

  console.log(`Built sidecar runtime at ${sidecarRootDir}`)
}

function main() {
  const profile = defaultSidecarProfile()
  validateSidecarProfile(profile)

  const python = resolvePython(ROOT_DIR)
  const pyInstaller = resolvePyInstaller(python)
  if (!pyInstaller) {
    throw new Error(
      'pyinstaller is required. Install with: pip install pyinstaller',
    )
  }

  const pythonExecutable = python ? getPythonExecutable(python) : null
  if (pythonExecutable) {
    console.log(`Using Python interpreter: ${pythonExecutable}`)
  }

  const calamariModelsSrc = path.join(
    ROOT_DIR,
    'backend',
    'ml',
    'calamari',
  )
  const krakenBllaModelSrc = resolveKrakenBllaModelPath(python)

  cleanPreviousOutputs()

  const pyinstallerArgs = createPyInstallerArgs({
    profile,
    rootDir: ROOT_DIR,
    outDir: SIDECAR_OUTPUT_DIR,
    bundleName: SIDECAR_BUNDLE_NAME,
    calamariModelsSrc,
    calamariModelsDest: path.join('backend', 'ml', 'calamari'),
    krakenBllaModelSrc,
    krakenBllaModelDest: 'kraken',
  })

  console.log(`Building sidecar with profile: ${profile}`)
  runCommand(
    pyInstaller.command,
    [...pyInstaller.prefixArgs, ...pyinstallerArgs],
    { stdio: 'inherit' },
  )

  finalizeSidecar()

  console.log(
    `Built deterministic sidecar resource ` +
      `${path.join(SIDECAR_OUTPUT_DIR, SIDECAR_BUNDLE_NAME)} ` +
      `(profile: ${profile})`,
  )
}

try {
  main()
} catch (error) {
  console.error(String(error?.message || error))
  process.exit(1)
}
