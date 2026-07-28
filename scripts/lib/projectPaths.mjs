import path from 'node:path'
import { fileURLToPath } from 'node:url'

export function projectRootFrom(importMetaUrl) {
  return path.resolve(path.dirname(fileURLToPath(importMetaUrl)), '..', '..')
}

export function scriptProjectRootFrom(importMetaUrl) {
  return path.resolve(path.dirname(fileURLToPath(importMetaUrl)), '..')
}
