/** Extract frontend symbols and Vue interfaces into a build-time JSON manifest. */
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import { execFileSync } from 'node:child_process'
import { parse as parseComponent } from 'vue-docgen-api'
import { parse as parseJavaScript } from '@babel/parser'
import sourceAdapter from './jsdoc-source.cjs'

const require = createRequire(import.meta.url)
const projectRoot = fileURLToPath(new URL('../../', import.meta.url))
const excluded = new Set(['__tests__', 'test', 'tests', 'node_modules', 'dist'])

/** Discover production JS and Vue files in a stable order, including new modules. */
export async function sourceFiles(directory) {
  const files = []
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    if (excluded.has(entry.name)) continue
    const filename = path.join(directory, entry.name)
    if (entry.isDirectory()) files.push(...await sourceFiles(filename))
    else if (/\.(js|vue)$/.test(entry.name) && !/\.(spec|test)\.js$/.test(entry.name)) files.push(filename)
  }
  return files.sort()
}

/** Keep named source symbols, including undocumented functions and nested helpers. */
export function symbolsForFile(doclets, filename, details = new Map()) {
  const symbols = new Map()
  for (const doclet of doclets) {
    if (!['function', 'class', 'member', 'constant'].includes(doclet.kind) || !doclet.meta?.code) continue
    // Assignment expressions and temporary local variables are not interfaces.
    // Keep every named callable, plus explicitly documented data/class fields.
    if (!['function', 'class'].includes(doclet.kind) && doclet.undocumented) continue
    if (path.resolve(doclet.meta.path, doclet.meta.filename) !== filename) continue
    if (!doclet.name || doclet.name.includes('<anonymous>') || doclet.ignore) continue
    // JSDoc emits aliases for export bindings and properties in returned objects.
    // Prefer the declaration at each location rather than showing it twice.
    const line = Math.max(1, doclet.meta.lineno - 1)
    const key = `${line}:${doclet.name}`
    const symbol = {
      name: doclet.name,
      qualifiedName: doclet.longname,
      owner: doclet.memberof,
      kind: doclet.kind,
      line,
      internal: doclet.access !== 'public' && (doclet.access === 'private' ||
        doclet.scope === 'inner' || doclet.longname.includes('~')),
      description: doclet.description || '',
      params: doclet.params || [],
      parameterNames: doclet.meta.code.paramnames || [],
      returns: doclet.returns || [],
      exceptions: doclet.exceptions || [],
      examples: doclet.examples || [],
      type: doclet.type?.names || [],
      async: doclet.async || false,
      ...details.get(key),
    }
    const previous = symbols.get(key)
    if (!previous || (!previous.description && symbol.description)) symbols.set(key, symbol)
  }
  return [...symbols.values()].sort((a, b) => a.line - b.line || a.name.localeCompare(b.name))
}

/** Preserve default/destructured parameters and directly returned object keys. */
function functionDetails(source, filename) {
  const script = sourceAdapter.scriptSource(source, filename)
  const ast = parseJavaScript(script, { sourceType: 'module', plugins: ['jsx'] })
  const details = new Map()
  function record(node, name, line = node.loc.start.line) {
    if (!name) return
    const returned = (node.body?.body || []).filter((child) => child.type === 'ReturnStatement')
      .flatMap((child) => child.argument?.type === 'ObjectExpression' ? child.argument.properties : [])
      .map((property) => property.key?.name || property.key?.value).filter(Boolean)
    details.set(`${line}:${name}`, {
      parameterNames: node.params.map((param) => script.slice(param.start, param.end)),
      returnedMembers: returned,
      async: node.async || false,
    })
  }
  function visit(node) {
    if (!node || typeof node !== 'object') return
    if (node.type === 'FunctionDeclaration') record(node, node.id?.name)
    if (node.type === 'VariableDeclarator' && /^(ArrowFunctionExpression|FunctionExpression)$/.test(node.init?.type)) {
      record(node.init, node.id.name, node.loc.start.line)
    }
    if (node.type === 'AssignmentExpression' && /^(ArrowFunctionExpression|FunctionExpression)$/.test(node.right?.type)) {
      record(node.right, node.left.name || node.left.property?.name, node.loc.start.line)
    }
    if (['ClassMethod', 'ObjectMethod'].includes(node.type)) record(node, node.key.name || node.key.value)
    for (const [key, child] of Object.entries(node)) {
      if (['loc', 'comments', 'tokens'].includes(key)) continue
      if (Array.isArray(child)) child.forEach(visit)
      else if (child && typeof child === 'object') visit(child)
    }
  }
  visit(ast)
  return details
}

/** Parse source only; no Vue app, Tauri host, or local backend is started. */
export async function extractFrontend(root = projectRoot) {
  const files = await sourceFiles(path.join(root, 'src'))
  if (!files.length) return []
  let output
  try {
    output = execFileSync(process.execPath, [
      require.resolve('jsdoc/jsdoc.js'), '-X', '-p',
      '-c', path.join(projectRoot, 'scripts/docs/jsdoc.json'), ...files,
    ], { cwd: projectRoot, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] })
  } catch (error) {
    throw new Error(`Frontend reference extraction failed:\n${error.stderr || error.message}`)
  }
  const doclets = JSON.parse(output)
  const pages = []
  for (const filename of files) {
    const source = await fs.readFile(filename, 'utf8')
    const fileDoc = doclets.find((d) => d.kind === 'file' && d.meta &&
      path.resolve(d.meta.path, d.meta.filename) === filename)
    const component = filename.endsWith('.vue') ? await parseComponent(filename) : null
    pages.push({
      source: path.relative(root, filename).split(path.sep).join('/'),
      // Template-only SFCs have no script in which to place a JSDoc @file block.
      description: fileDoc?.description || component?.description ||
        source.match(/^\s*<!--\s*@file\s+([\s\S]*?)\s*-->/)?.[1]?.trim() || '',
      symbols: symbolsForFile(doclets, filename, functionDetails(source, filename)),
      component: component && {
        props: component.props || [], events: component.events || [],
        slots: component.slots || [], methods: component.methods || [],
      },
    })
  }
  return pages
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.stdout.write(JSON.stringify(await extractFrontend()))
}
