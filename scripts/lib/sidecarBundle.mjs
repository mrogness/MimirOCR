import {
  existsSync,
  lstatSync,
  readlinkSync,
  rmSync,
  symlinkSync,
} from 'node:fs'
import path from 'node:path'


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
