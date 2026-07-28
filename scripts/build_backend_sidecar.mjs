#!/usr/bin/env node
import { chmodSync, mkdirSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import { commandExists, runCommand } from './lib/commands.mjs'
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
  createPosixLauncherSidecar,
  deduplicateTensorFlowBinary,
  runSidecarSmokeTestWithPolicy,
  sidecarExecutablePath,
  signSidecarIfNeeded,
} from './lib/sidecarBundle.mjs'

const ROOT_DIR = scriptProjectRootFrom(import.meta.url)
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

function detectRustTargetTriple() {
  if (!commandExists('rustc')) {
    throw new Error('rustc is required to detect target triple')
  }

  const rustInfo = runCommand('rustc', ['-vV']).stdout || ''
  const hostLine = rustInfo
    .split(/\r?\n/)
    .find((line) => line.toLowerCase().startsWith('host:'))
  const targetTriple = hostLine?.split(':')[1]?.trim()

  if (!targetTriple) {
    throw new Error('Unable to detect Rust host target triple')
  }

  return targetTriple
}

function cleanPreviousOutputs({ outDir, launcherName, bundleName, sentinelPath }) {
  mkdirSync(outDir, { recursive: true })
  cleanPathIfExists(path.join(outDir, bundleName))
  cleanPathIfExists(path.join(outDir, `${bundleName}.exe`))
  cleanPathIfExists(path.join(outDir, launcherName))
  cleanPathIfExists(path.join(outDir, `${launcherName}.exe`))

  // The sentinel remains until a real sidecar has been produced successfully.
  void sentinelPath
}

function finalizeSidecar({
  outDir,
  launcherName,
  bundleName,
  sentinelPath,
}) {
  const sidecarRootDir = path.join(outDir, bundleName)
  const executablePath = sidecarExecutablePath(outDir, bundleName)

  deduplicateTensorFlowBinary(sidecarRootDir)

  if (process.platform === 'win32') {
    runSidecarSmokeTestWithPolicy(executablePath)
    cleanPathIfExists(sentinelPath)
    console.log(`Built Windows onedir sidecar runtime at ${sidecarRootDir}`)
    return
  }

  chmodSync(executablePath, 0o755)
  runSidecarSmokeTestWithPolicy(executablePath)
  signSidecarIfNeeded(executablePath)

  const launcherPath = createPosixLauncherSidecar(
    outDir,
    launcherName,
    bundleName,
  )
  runSidecarSmokeTestWithPolicy(launcherPath)
  cleanPathIfExists(sentinelPath)

  console.log(
    `Built launcher sidecar ${launcherPath} using in-bundle runtime directory ${sidecarRootDir}`,
  )
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

  const targetTriple = detectRustTargetTriple()
  const outDir = path.join('src-tauri', 'binaries')
  const launcherName = `backend-${targetTriple}`
  const bundleName = `${launcherName}-bundle`
  const sentinelPath = path.join(outDir, 'backend-sentinel')

  const calamariModelsSrc = path.join(
    ROOT_DIR,
    'backend',
    'ml',
    'calamari',
  )
  const krakenBllaModelSrc = resolveKrakenBllaModelPath(python)

  cleanPreviousOutputs({
    outDir,
    launcherName,
    bundleName,
    sentinelPath,
  })

  const pyinstallerArgs = createPyInstallerArgs({
    profile,
    rootDir: ROOT_DIR,
    outDir,
    bundleName,
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

  finalizeSidecar({
    outDir,
    launcherName,
    bundleName,
    sentinelPath,
  })

  console.log(
    `Built onedir sidecar bundle in ${path.join(outDir, bundleName)} ` +
      `(launcher: ${launcherName}, profile: ${profile})`,
  )
}

try {
  main()
} catch (error) {
  console.error(String(error?.message || error))
  process.exit(1)
}
