import assert from 'node:assert/strict'
import { test } from 'node:test'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { RUNTIMES } from '../lib/runtimes.mjs'
import { createPyInstallerArgs } from '../lib/pyinstallerConfig.mjs'

test('segmenter and build installation cannot inherit the legacy ML constraints', () => {
  const root = fileURLToPath(new URL('../../', import.meta.url))
  function constraintsFor(...files) {
    const constraints = new Set()
    const seen = new Set()
    function visit(file) {
      if (seen.has(file)) return
      seen.add(file)
      for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
        const include = line.match(/^\s*(-[rc])\s+(\S+)/)
        if (!include) continue
        const target = path.resolve(path.dirname(file), include[2])
        if (include[1] === '-c') constraints.add(path.relative(root, target).split(path.sep).join('/'))
        visit(target)
      }
    }
    files.forEach(file => visit(path.join(root, file)))
    return [...constraints].sort()
  }
  for (const spec of ['requirements/segmenter.txt', 'requirements/segmenter-modern.txt']) {
    assert.deepEqual(constraintsFor(spec, 'requirements/build.txt'),
      ['requirements/constraints-segmenter.txt'])
  }
  for (const role of ['backend', 'recognizer']) {
    assert.deepEqual(constraintsFor(`requirements/${role}.txt`, 'requirements/build.txt'),
      ['constraints.txt'])
  }
  const pins = readFileSync(path.join(root, 'requirements/constraints-segmenter.txt'), 'utf8')
  const kraken = pins.match(/^kraken==(.+)$/m)[1].trim()
  assert.equal(RUNTIMES.segmenter.versions.kraken, kraken,
    'Preflight and setup must agree on the Kraken version')
})

test('each onedir build has a distinct name, work directory, and entry point', () => {
  const names = new Set()
  const work = new Set()
  for (const [role, runtime] of Object.entries(RUNTIMES)) {
    const args = createPyInstallerArgs('/repo with spaces', role, '/kraken/blla.mlmodel')
    names.add(args[args.indexOf('--name') + 1])
    work.add(args[args.indexOf('--workpath') + 1])
    assert.ok(args.includes('--onedir'))
    assert.ok(args.includes('--console'), 'Windows pipes require console builds')
    assert.ok(!args.includes('--noconsole'))
    assert.ok(!args.includes('backend'), 'Do not collect all backend modules into every runtime')
    for (const excluded of runtime.forbidden) {
      const index = args.indexOf(excluded)
      assert.equal(args[index - 1], '--exclude-module')
    }
    assert.ok(args.at(-1).endsWith(runtime.entry))
  }
  assert.equal(names.size, 3)
  assert.equal(work.size, 3)
})

test('Tauri includes all three complete runtime directories', () => {
  const config = JSON.parse(readFileSync(new URL('../../src-tauri/tauri.conf.json', import.meta.url)))
  for (const { name } of Object.values(RUNTIMES)) {
    assert.equal(config.bundle.resources[`resources/${name}/`], `${name}/`)
  }
})

test('worker package entry points exist and engine packages stay isolated', () => {
  for (const [role, runtime] of Object.entries(RUNTIMES)) {
    assert.ok(existsSync(new URL(`../../${runtime.entry}`, import.meta.url)))
    const args = createPyInstallerArgs('/repo', role, '/kraken/blla.mlmodel')
    for (const other of ['segmenter', 'recognizer']) {
      const packageName = `backend.workers.${other}`
      if (other === role) {
        assert.ok(!args.includes(packageName), 'The owning engine must remain available')
      } else {
        const index = args.indexOf(packageName)
        assert.ok(index > 0, `Missing exclusion: ${packageName}`)
        assert.equal(args[index - 1], '--exclude-module')
      }
    }
  }
})
