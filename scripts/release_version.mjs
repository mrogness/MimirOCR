#!/usr/bin/env node
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'

import { scriptProjectRootFrom } from './lib/projectPaths.mjs'

const ROOT_DIR = scriptProjectRootFrom(import.meta.url)

function runGit(args, options = {}) {
  const result = execFileSync('git', args, {
    cwd: ROOT_DIR,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    ...options,
  })

  return typeof result === 'string' ? result.trim() : ''
}

function fail(message) {
  console.error(`release: ${message}`)
  process.exit(1)
}

function isSemverLike(value) {
  return /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(
    value,
  )
}

function updateJsonVersion(filePath, version) {
  const json = JSON.parse(readFileSync(filePath, 'utf8'))
  json.version = version
  writeFileSync(filePath, `${JSON.stringify(json, null, 2)}\n`, 'utf8')
}

function updateCargoToml(filePath, version) {
  const raw = readFileSync(filePath, 'utf8')
  const next = raw.replace(
    /(\[package\][\s\S]*?\nversion\s*=\s*")([^"]+)(")/,
    `$1${version}$3`,
  )

  if (next === raw) {
    fail(`could not update version in ${path.relative(ROOT_DIR, filePath)}`)
  }

  writeFileSync(filePath, next, 'utf8')
}

function updateCargoLock(filePath, version) {
  const raw = readFileSync(filePath, 'utf8')
  const next = raw.replace(
    /(\[\[package\]\][\s\S]*?\nname\s*=\s*"mimir"\s*\nversion\s*=\s*")([^"]+)(")/,
    `$1${version}$3`,
  )

  if (next === raw) {
    fail(
      `could not update mimir package version in ${path.relative(ROOT_DIR, filePath)}`,
    )
  }

  writeFileSync(filePath, next, 'utf8')
}

function assertTagDoesNotExist(tag) {
  try {
    runGit(['rev-parse', '--verify', `refs/tags/${tag}`])
    fail(`tag ${tag} already exists locally`)
  } catch {
    // Expected when the tag does not exist.
  }

  if (runGit(['ls-remote', '--tags', 'origin', tag])) {
    fail(`tag ${tag} already exists on origin`)
  }
}

function main() {
  const args = process.argv.slice(2)
  const version = args[0]
  const shouldPush = !args.includes('--no-push')

  if (!version) {
    fail('usage: yarn release:tag <version> [--no-push]')
  }

  if (!isSemverLike(version)) {
    fail(
      `invalid version '${version}', expected semver like 0.1.1 or 1.2.0-rc.1`,
    )
  }

  if (runGit(['status', '--porcelain'])) {
    fail('working tree is not clean; commit or stash changes first')
  }

  const tag = `v${version}`
  assertTagDoesNotExist(tag)

  const currentBranch = runGit(['rev-parse', '--abbrev-ref', 'HEAD'])
  if (!currentBranch || currentBranch === 'HEAD') {
    fail('detached HEAD is not supported for release:tag')
  }

  const packageJsonPath = path.join(ROOT_DIR, 'package.json')
  const tauriConfigPath = path.join(ROOT_DIR, 'src-tauri', 'tauri.conf.json')
  const cargoTomlPath = path.join(ROOT_DIR, 'src-tauri', 'Cargo.toml')
  const cargoLockPath = path.join(ROOT_DIR, 'src-tauri', 'Cargo.lock')

  updateJsonVersion(packageJsonPath, version)
  updateJsonVersion(tauriConfigPath, version)
  updateCargoToml(cargoTomlPath, version)
  updateCargoLock(cargoLockPath, version)

  runGit([
    'add',
    'package.json',
    'src-tauri/tauri.conf.json',
    'src-tauri/Cargo.toml',
    'src-tauri/Cargo.lock',
  ])

  if (runGit(['diff', '--cached', '--name-only'])) {
    runGit(['commit', '-m', `release: ${tag}`], { stdio: 'inherit' })
  } else {
    console.log(
      'release: version files already committed; skipping commit step.',
    )
  }

  runGit(['tag', '-a', tag, '-m', tag])

  if (shouldPush) {
    runGit(['push', 'origin', currentBranch], { stdio: 'inherit' })
    runGit(['push', 'origin', tag], { stdio: 'inherit' })
    console.log(
      `release: pushed ${tag}; GitHub Actions should publish release assets.`,
    )
    return
  }

  console.log(`release: created commit and tag ${tag} locally (no push).`)
  console.log(
    `release: run 'git push origin ${currentBranch}' and 'git push origin ${tag}' when ready.`,
  )
}

main()
