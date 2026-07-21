#!/usr/bin/env node
import { spawnSync } from 'node:child_process'
import { chmodSync, existsSync, mkdirSync, rmSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
process.chdir(ROOT_DIR)

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    stdio: 'pipe',
    encoding: 'utf8',
    shell: false,
    ...options,
  })

  if (result.error) {
    throw result.error
  }

  if (result.status !== 0) {
    const stderr = result.stderr?.trim() || ''
    const stdout = result.stdout?.trim() || ''
    const detail = stderr || stdout || `exit code ${result.status}`
    throw new Error(`${command} failed: ${detail}`)
  }

  return result.stdout || ''
}

function commandExists(command, args = ['--version']) {
  const result = spawnSync(command, args, { stdio: 'ignore', shell: false })
  return result.status === 0
}

function tryCommand(command, args = []) {
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

function resolvePythonCommand() {
  const envPython = (process.env.MIMIR_PYTHON || process.env.PYTHON || '').trim()
  if (envPython && commandExists(envPython, ['--version'])) {
    return { cmd: envPython, argsPrefix: [] }
  }

  if (process.env.VIRTUAL_ENV) {
    const venvPython = process.platform === 'win32'
      ? path.join(process.env.VIRTUAL_ENV, 'Scripts', 'python.exe')
      : path.join(process.env.VIRTUAL_ENV, 'bin', 'python')
    if (commandExists(venvPython, ['--version'])) {
      return { cmd: venvPython, argsPrefix: [] }
    }
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

  for (const candidate of localVenvCandidates) {
    if (commandExists(candidate, ['--version'])) {
      return { cmd: candidate, argsPrefix: [] }
    }
  }

  if (commandExists('python', ['--version'])) {
    return { cmd: 'python', argsPrefix: [] }
  }

  if (commandExists('python3', ['--version'])) {
    return { cmd: 'python3', argsPrefix: [] }
  }

  if (commandExists('py', ['-3', '--version'])) {
    return { cmd: 'py', argsPrefix: ['-3'] }
  }

  return null
}

function resolveKrakenBllaModelPath() {
  const python = resolvePythonCommand()
  if (!python) {
    return ''
  }

  const code = [
    'from pathlib import Path',
    'import kraken',
    'p = Path(kraken.__file__).resolve().parent / "blla.mlmodel"',
    'print(str(p) if p.exists() else "")',
  ].join('; ')

  const result = tryCommand(python.cmd, [...python.argsPrefix, '-c', code])
  if (!result) {
    return ''
  }

  return String(result.stdout || '').trim()
}

function resolvePyInstallerRunner() {
  if (commandExists('pyinstaller', ['--version'])) {
    return { cmd: 'pyinstaller', argsPrefix: [] }
  }

  const python = resolvePythonCommand()
  if (!python) {
    return null
  }

  const check = tryCommand(python.cmd, [...python.argsPrefix, '-m', 'PyInstaller', '--version'])
  if (!check) {
    return null
  }

  return {
    cmd: python.cmd,
    argsPrefix: [...python.argsPrefix, '-m', 'PyInstaller'],
  }
}

function resolveCodesignCommand() {
  if (commandExists('codesign', ['-h'])) {
    return { cmd: 'codesign', argsPrefix: [] }
  }
  if (commandExists('xcrun', ['-f', 'codesign'])) {
    return { cmd: 'xcrun', argsPrefix: ['codesign'] }
  }
  return null
}

function parseProfileArg() {
  const argv = process.argv.slice(2)
  const byFlag = argv.findIndex((token) => token === '--profile')
  if (byFlag >= 0 && argv[byFlag + 1]) {
    return String(argv[byFlag + 1]).trim().toLowerCase()
  }

  const byEq = argv.find((token) => token.startsWith('--profile='))
  if (byEq) {
    return String(byEq.split('=')[1] || '').trim().toLowerCase()
  }

  const fromEnv = (process.env.MIMIR_SIDECAR_PROFILE || '').trim().toLowerCase()
  return fromEnv || 'standard'
}

function profileOptions(profile) {
  if (profile !== 'lean' && profile !== 'aggressive') {
    return []
  }

  // Keep runtime OCR path intact while trimming optional heavy stacks that are
  // not imported by this backend at runtime.
  const excludes = [
    'matplotlib',
    'matplotlib.pyplot',
    'IPython',
    'ipykernel',
    'jupyter_client',
    'jupyter_core',
    'debugpy',
    'pandas',
    'openpyxl',
    'xlsxwriter',
    'tkinter',
  ]

  if (profile === 'aggressive') {
    excludes.push(
      'torchmetrics',
      'pytorch_lightning',
      'tensorboard',
      'tensorboard_data_server',
      'tensorboard_plugin_wit',
      'tensorflow_estimator',
      'tensorflow.compiler.tf2tensorrt',
      'tensorflow.lite',
      'tensorflow.python.profiler',
      'tensorflow.python.data.experimental.service',
    )
  }

  const args = ['--strip']
  for (const mod of excludes) {
    args.push('--exclude-module', mod)
  }
  return args
}

function signSidecarIfNeeded(binaryPath) {
  if (process.platform !== 'darwin') {
    return
  }

  // PyInstaller already re-signs onefile binaries on macOS. Re-signing again
  // here can corrupt the appended PKG archive for large TensorFlow payloads.
  // Opt in explicitly only when needed.
  if (process.env.MIMIR_FORCE_CODESIGN_SIDECAR !== '1') {
    return
  }

  const codesign = resolveCodesignCommand()
  if (!codesign) {
    throw new Error('codesign is required on macOS to sign the sidecar binary')
  }

  run(codesign.cmd, [...codesign.argsPrefix,
    '--force',
    '--sign',
    '-',
    '--timestamp=none',
    '--verbose',
    binaryPath,
  ], { stdio: 'inherit' })

  run(codesign.cmd, [...codesign.argsPrefix,
    '--verify',
    '--verbose',
    binaryPath,
  ], { stdio: 'inherit' })
}

function runSidecarSmokeTest(binaryPath) {
  // The sidecar imports backend modules at process startup, so a --help run
  // catches missing bundled imports before we ship an installer.
  run(binaryPath, ['--help'], { stdio: 'pipe' })
}

function runSidecarSmokeTestWithPolicy(binaryPath) {
  const skipSmoke = process.env.MIMIR_SIDECAR_SKIP_SMOKE_TEST === '1'

  if (skipSmoke) {
    console.warn('Skipping sidecar smoke test (MIMIR_SIDECAR_SKIP_SMOKE_TEST=1).')
    return
  }

  runSidecarSmokeTest(binaryPath)
}

function cleanPathIfExists(targetPath) {
  if (!existsSync(targetPath)) {
    return
  }
  rmSync(targetPath, { recursive: true, force: true })
}

function sidecarExecutablePath(outDir, binName) {
  const executableName = process.platform === 'win32' ? `${binName}.exe` : binName
  return path.join(outDir, binName, executableName)
}

try {
  const profile = parseProfileArg()
  if (!['standard', 'lean', 'aggressive'].includes(profile)) {
    throw new Error(`Unsupported sidecar profile '${profile}'. Use 'standard', 'lean', or 'aggressive'.`)
  }

  if (!commandExists('rustc')) {
    throw new Error('rustc is required to detect target triple')
  }

  const pyInstallerRunner = resolvePyInstallerRunner()
  if (!pyInstallerRunner) {
    throw new Error('pyinstaller is required. Install with: pip install pyinstaller')
  }

  const rustInfo = run('rustc', ['-vV'])
  const hostLine = rustInfo
    .split(/\r?\n/)
    .find((line) => line.toLowerCase().startsWith('host:'))
  const targetTriple = hostLine?.split(':')[1]?.trim()

  if (!targetTriple) {
    throw new Error('Unable to detect Rust host target triple')
  }

  const outDir = path.join('src-tauri', 'binaries')
  const binName = `backend-${targetTriple}`
  const dataSeparator = process.platform === 'win32' ? ';' : ':'
  const calamariModelsSrc = path.join(ROOT_DIR, 'backend', 'ml', 'calamari')
  const calamariModelsDest = path.join('backend', 'ml', 'calamari')
  const krakenBllaModelSrc = resolveKrakenBllaModelPath()
  const krakenBllaModelDest = 'kraken'

  mkdirSync(outDir, { recursive: true })
  cleanPathIfExists(path.join(outDir, binName))
  cleanPathIfExists(path.join(outDir, `${binName}.exe`))

  const pyinstallerArgs = [
    '--noconfirm',
    '--clean',
    '--onedir',
    ...(process.platform === 'win32' ? ['--noconsole'] : []),
    '--paths',
    ROOT_DIR,
    '--collect-submodules',
    'backend',
    '--collect-all',
    'kraken',
    '--collect-all',
    'calamari_ocr',
    '--hidden-import',
    'kraken.blla',
    '--hidden-import',
    'kraken.lib.segmentation',
    '--add-data',
    `${calamariModelsSrc}${dataSeparator}${calamariModelsDest}`,
    ...(krakenBllaModelSrc
      ? ['--add-data', `${krakenBllaModelSrc}${dataSeparator}${krakenBllaModelDest}`]
      : []),
    '--name',
    binName,
    '--distpath',
    outDir,
    '--workpath',
    path.join('.pyinstaller', 'build'),
    '--specpath',
    path.join('.pyinstaller', 'spec'),
    ...profileOptions(profile),
    path.join('backend', 'sidecar_main.py'),
  ]

  console.log(`Building sidecar with profile: ${profile}`)

  run(pyInstallerRunner.cmd, [...pyInstallerRunner.argsPrefix, ...pyinstallerArgs], { stdio: 'inherit' })

  const outPath = sidecarExecutablePath(outDir, binName)

  if (process.platform !== 'win32') {
    chmodSync(outPath, 0o755)
    runSidecarSmokeTestWithPolicy(outPath)
    signSidecarIfNeeded(outPath)
  } else {
    runSidecarSmokeTestWithPolicy(outPath)
  }

  console.log(`Built onedir sidecar in ${path.join(outDir, binName)} (base name: ${binName}, profile: ${profile})`)
} catch (error) {
  console.error(String(error?.message || error))
  process.exit(1)
}
