import assert from 'node:assert/strict'
import { test } from 'node:test'
import { existsSync, readFileSync } from 'node:fs'
import { RUNTIMES } from '../lib/runtimes.mjs'
import { createPyInstallerArgs } from '../lib/pyinstallerConfig.mjs'

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
