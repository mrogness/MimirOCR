#!/usr/bin/env node
// Use the same interpreter selection as development, workers, and packaging.
import { runCommand } from './lib/commands.mjs'
import { runtimePython } from './lib/runtimes.mjs'
import { scriptProjectRootFrom } from './lib/projectPaths.mjs'

const root = scriptProjectRootFrom(import.meta.url)
runCommand(runtimePython(root, 'backend'), process.argv.slice(2), { stdio: 'inherit' })
