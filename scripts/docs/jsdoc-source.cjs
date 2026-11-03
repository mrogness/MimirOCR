/** Adapt Vue scripts to JSDoc without compiling or executing application code. */
const path = require('node:path')
const { parse } = require('@vue/compiler-sfc')

function scriptSource(source, filename) {
  if (filename.endsWith('.vue')) {
    const { descriptor, errors } = parse(source, { filename })
    if (errors.length) throw new Error(`${filename}: ${errors.join('\n')}`)
    // Preserve offsets and newlines so source links still point into the SFC.
    let script = source.replace(/[^\r\n]/g, ' ')
    for (const block of [descriptor.script, descriptor.scriptSetup].filter(Boolean)) {
      const start = block.loc.start.offset
      script = script.slice(0, start) + block.content + script.slice(start + block.content.length)
    }
    return script
  }
  return source
}

exports.scriptSource = scriptSource
exports.handlers = {
  beforeParse(event) {
    event.source = scriptSource(event.source, event.filename)
    const relative = path.relative(path.resolve('src'), event.filename)
      .split(path.sep).join('/').replace(/\.(js|vue)$/, '')
    // Every file is a module, even when its author has not added a comment yet.
    // The renderer subtracts this synthetic line from JSDoc's source positions.
    event.source = `/** @module ${relative} */\n${event.source}`
  },
}
