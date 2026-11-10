import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { extractFrontend, sourceFiles } from '../docs/frontend.mjs'

test('discover new source files and remove renamed/deleted paths while excluding tests', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'mimir-docs-discovery-'))
  try {
    await fs.mkdir(path.join(root, '__tests__'))
    await fs.writeFile(path.join(root, 'first.js'), '')
    await fs.writeFile(path.join(root, 'ignored.spec.js'), '')
    await fs.writeFile(path.join(root, '__tests__/hidden.js'), '')
    assert.deepEqual((await sourceFiles(root)).map((file) => path.basename(file)), ['first.js'])
    await fs.rename(path.join(root, 'first.js'), path.join(root, 'renamed.vue'))
    assert.deepEqual((await sourceFiles(root)).map((file) => path.basename(file)), ['renamed.vue'])
    await fs.unlink(path.join(root, 'renamed.vue'))
    assert.deepEqual(await sourceFiles(root), [])
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }
})

test('extract undocumented functions, nested arrows, classes, and Vue contracts without execution', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'mimir-docs-extract-'))
  try {
    await fs.mkdir(path.join(root, 'src'))
    await fs.writeFile(path.join(root, 'src/helpers.js'), `/** @file Fixture module. */
throw new Error('Application code must not run');
export function undocumented(value = 3) {
  const nested = (item) => item + value;
  return nested;
}
export function destructured({ count = 2 } = {}) { return { count }; }
/**
 * Save the fixture.
 * @param {object} dependencies - Inputs.
 * @param {Function} dependencies.write - Save callback.
 * @returns {Promise<void>} Saved.
 * @throws {Error} Save failure.
 * @example
 * await save({ write: async () => {} });
 */
export async function save({ write }) { await write(); }
export class Reader { read(input) { return input; } }
`)
    const component = `<template><slot name="footer" /></template>
<script setup>
/** @file Fixture component. */
defineProps({ label: { type: String, default: 'Read' } });
const emit = defineEmits(['done']);
function click() { emit('done'); }
</script>`
    await fs.writeFile(path.join(root, 'src/Reader.vue'), component)
    await fs.writeFile(path.join(root, 'src/Static.vue'),
      '<!-- @file Template-only reference description. -->\n<template><p>Help</p></template>')
    const pages = await extractFrontend(root)
    const helpers = pages.find((page) => page.source.endsWith('helpers.js'))
    assert.equal(helpers.description, 'Fixture module.')
    assert.ok(helpers.symbols.some((symbol) => symbol.name === 'undocumented' && !symbol.description))
    assert.deepEqual(helpers.symbols.find((symbol) => symbol.name === 'undocumented').parameterNames, ['value = 3'])
    const destructured = helpers.symbols.find((symbol) => symbol.name === 'destructured')
    assert.deepEqual(destructured.parameterNames, ['{ count = 2 } = {}'])
    assert.deepEqual(destructured.returnedMembers, ['count'])
    const save = helpers.symbols.find((symbol) => symbol.name === 'save')
    assert.ok(save.params.some((parameter) => parameter.name === 'dependencies.write'))
    assert.match(save.examples[0], /await save/)
    assert.equal(save.exceptions[0].description, 'Save failure.')
    assert.ok(helpers.symbols.some((symbol) => symbol.name === 'nested' && symbol.internal))
    assert.ok(helpers.symbols.some((symbol) => symbol.name === 'Reader' && symbol.kind === 'class'))
    assert.ok(helpers.symbols.some((symbol) => symbol.name === 'read'))
    const vue = pages.find((page) => page.source.endsWith('.vue'))
    assert.equal(vue.component.props[0].name, 'label')
    assert.equal(vue.component.events[0].name, 'done')
    assert.equal(vue.component.slots[0].name, 'footer')
    const click = vue.symbols.find((symbol) => symbol.name === 'click')
    assert.equal(component.split('\n')[click.line - 1], "function click() { emit('done'); }")
    assert.equal(pages.find((page) => page.source.endsWith('Static.vue')).description,
      'Template-only reference description.')
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }
})

test('production frontend modules, symbols, and component interfaces have descriptions', async () => {
  const pages = await extractFrontend()
  const missing = []
  for (const page of pages) {
    if (!page.description.trim()) missing.push(`${page.source}: module`)
    for (const symbol of page.symbols) {
      if (!symbol.description.trim()) missing.push(`${page.source}: ${symbol.name}`)
    }
    if (page.component) {
      for (const kind of ['props', 'events', 'slots', 'methods']) {
        for (const item of page.component[kind]) {
          if (!item.description?.trim()) missing.push(`${page.source}: ${kind} ${item.name}`)
        }
      }
    }
  }
  assert.deepEqual(missing, [], `Missing source descriptions:\n${missing.join('\n')}`)
})

test('malformed source fails extraction instead of silently omitting a module', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'mimir-docs-invalid-'))
  try {
    await fs.mkdir(path.join(root, 'src'))
    await fs.writeFile(path.join(root, 'src/broken.js'), 'export function broken( {')
    await assert.rejects(extractFrontend(root), /Frontend reference extraction failed/)
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }
})
