import path from 'node:path'
import { fileURLToPath } from 'node:url'

export function scriptProjectRootFrom(importMetaUrl) {
  return path.resolve(path.dirname(fileURLToPath(importMetaUrl)), '..')
}
