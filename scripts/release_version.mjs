#!/usr/bin/env node
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const ROOT_DIR = path.resolve(__dirname, '..')

function runGit(args, options = {}) {
  const result = execFileSync('git', args, {
    cwd: ROOT_DIR,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    ...options,
  })

  if (typeof result !== 'string') {
    return ''
  }

  return result.trim()
}

function fail(message) {
  console.error(`release: ${message}`)
  process.exit(1)
}

function isSemverLike(value) {
  return /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(value)
}

function updatePackageJson(filePath, version) {
  const raw = readFileSync(filePath, 'utf8')
  const json = JSON.parse(raw)
  json.version = version
  writeFileSync(filePath, `${JSON.stringify(json, null, 2)}\n`, 'utf8')
}

function updateTauriConfig(filePath, version) {
  const raw = readFileSync(filePath, 'utf8')
  const json = JSON.parse(raw)
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

function main() {
  const args = process.argv.slice(2)
  const version = args[0]
  const shouldPush = !args.includes('--no-push')

  if (!version) {
    fail('usage: yarn release:tag <version> [--no-push]')
  }

  if (!isSemverLike(version)) {
    fail(`invalid version '${version}', expected semver like 0.1.1 or 1.2.0-rc.1`)
  }

  const tag = `v${version}`

  const status = runGit(['status', '--porcelain'])
  if (status) {
    fail('working tree is not clean; commit or stash changes first')
  }

  try {
    runGit(['rev-parse', '--verify', `refs/tags/${tag}`])
    fail(`tag ${tag} already exists locally`)
  } catch {
    // expected when tag does not exist
  }

  const remoteTag = runGit(['ls-remote', '--tags', 'origin', tag])
  if (remoteTag) {
    fail(`tag ${tag} already exists on origin`)
  }

  const currentBranch = runGit(['rev-parse', '--abbrev-ref', 'HEAD'])
  if (!currentBranch || currentBranch === 'HEAD') {
    fail('detached HEAD is not supported for release:tag')
  }

  const packageJsonPath = path.join(ROOT_DIR, 'package.json')
  const tauriConfigPath = path.join(ROOT_DIR, 'src-tauri', 'tauri.conf.json')
  const cargoTomlPath = path.join(ROOT_DIR, 'src-tauri', 'Cargo.toml')

  updatePackageJson(packageJsonPath, version)
  updateTauriConfig(tauriConfigPath, version)
  updateCargoToml(cargoTomlPath, version)

  runGit(['add', 'package.json', 'src-tauri/tauri.conf.json', 'src-tauri/Cargo.toml'])

  const stagedDiff = runGit(['diff', '--cached', '--name-only'])
  if (stagedDiff) {
    runGit(['commit', '-m', `release: ${tag}`], { stdio: 'inherit' })
  } else {
    console.log('release: version files already committed; skipping commit step.')
  }

  runGit(['tag', '-a', tag, '-m', tag])

  if (shouldPush) {
    runGit(['push', 'origin', currentBranch], { stdio: 'inherit' })
    runGit(['push', 'origin', tag], { stdio: 'inherit' })
    console.log(`release: pushed ${tag}; GitHub Actions should publish release assets.`)
  } else {
    console.log(`release: created commit and tag ${tag} locally (no push).`)
    console.log(`release: run 'git push origin ${currentBranch}' and 'git push origin ${tag}' when ready.`)
  }
}

main()
