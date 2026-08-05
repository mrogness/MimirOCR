import {
  existsSync,
  lstatSync,
  readlinkSync,
  rmSync,
  symlinkSync,
} from 'node:fs'
import path from 'node:path'

import { runCommand } from './commands.mjs'

function lstatExists(targetPath) {
  try {
    lstatSync(targetPath)
    return true
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return false
    }
    throw error
  }
}

function replaceDuplicateWithSymlink({
  internalDir,
  duplicateRelativePath,
  canonicalRelativePath,
}) {
  const duplicatePath = path.join(internalDir, duplicateRelativePath)
  const canonicalPath = path.join(internalDir, canonicalRelativePath)

  if (!existsSync(canonicalPath)) {
    throw new Error(`Canonical PyInstaller binary is missing: ${canonicalPath}`)
  }

  if (lstatExists(duplicatePath)) {
    rmSync(duplicatePath, { force: true })
  }

  const relativeTarget = path.relative(path.dirname(duplicatePath), canonicalPath)
  symlinkSync(relativeTarget, duplicatePath)

  if (!lstatSync(duplicatePath).isSymbolicLink()) {
    throw new Error(`Expected symbolic link after deduplication: ${duplicatePath}`)
  }

  const actualTarget = readlinkSync(duplicatePath)
  if (actualTarget !== relativeTarget) {
    throw new Error(
      `Incorrect TensorFlow symlink target for ${duplicatePath}: expected ${relativeTarget}, got ${actualTarget}`,
    )
  }

  if (!existsSync(duplicatePath)) {
    throw new Error(`TensorFlow symlink does not resolve: ${duplicatePath}`)
  }

  console.log(`Symlinked ${duplicateRelativePath} -> ${relativeTarget}`)
}

export function deduplicateTensorFlowBinary(bundleDir) {
  if (process.platform !== 'darwin') {
    return
  }

  const internalDir = path.join(bundleDir, '_internal')
  if (!existsSync(internalDir)) {
    throw new Error(`PyInstaller internal directory is missing: ${internalDir}`)
  }

  replaceDuplicateWithSymlink({
    internalDir,
    duplicateRelativePath: '_pywrap_tensorflow_internal.so',
    canonicalRelativePath: 'tensorflow/python/_pywrap_tensorflow_internal.so',
  })
}

export function cleanPathIfExists(targetPath) {
  if (existsSync(targetPath)) {
    rmSync(targetPath, { recursive: true, force: true })
  }
}

export function sidecarExecutablePath(outDir, bundleName) {
  const executableName =
    process.platform === 'win32' ? `${bundleName}.exe` : bundleName
  return path.join(outDir, bundleName, executableName)
}

function runSidecarSmokeTest(binaryPath) {
  runCommand(binaryPath, ['--help'], { stdio: 'pipe' })
}

export function runSidecarSmokeTestWithPolicy(binaryPath) {
  const strictSmoke = (process.env.CI || '').toLowerCase() === 'true'

  try {
    runSidecarSmokeTest(binaryPath)
  } catch (error) {
    const message = String(error?.message || error)
    const protobufDescriptorCollision =
      message.includes(
        'File already exists in database: tensorflow/core/protobuf/replay_log.proto',
      ) ||
      message.includes(
        'GeneratedDatabase()->Add(encoded_file_descriptor, size)',
      )

    if (protobufDescriptorCollision && !strictSmoke) {
      console.warn(
        'Sidecar smoke test hit known TensorFlow/protobuf descriptor collision; continuing build outside CI.',
      )
      return
    }

    throw error
  }
}

export function signSidecarIfNeeded(binaryPath) {
  // Intentionally disabled: default behavior does not re-sign sidecar binaries.
  void binaryPath
}
