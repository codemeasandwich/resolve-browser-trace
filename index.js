'use strict'

const { originalPositionFor, sourceContentFor } = require('@jridgewell/trace-mapping')
const { formatStack } = require('./src/format')
const { bundleFileName, createMapStore } = require('./src/map-store')
const { parseStack } = require('./src/parse-stack')
const { sanitize } = require('./src/sanitize')
const { normalizeSource, rootSegments } = require('./src/source-path')

const DEFAULTS = { maxStackLength: 65536, maxFrames: 100, maxCachedMaps: 16, maxMapsPerStack: 4, maxMapBytes: 32 * 1024 * 1024 }
const MAX_SOURCE_LINE = 300

function positiveInteger(options, key) {
  const value = options[key]
  if (value === undefined) {
    return DEFAULTS[key]
  }
  if (!Number.isInteger(value) || value < 1) {
    throw new TypeError(`resolve-browser-trace: ${key} must be a positive integer`)
  }
  return value
}

function normalizeOptions(input) {
  const options = typeof input === 'string' ? { mapsDir: input } : input
  if (typeof options !== 'object' || options === null) {
    throw new TypeError('resolve-browser-trace: pass a maps directory or an options object')
  }
  const { mapsDir, maps, loadMap, root, includeSource, onError } = options
  if (mapsDir === undefined && maps === undefined && loadMap === undefined) {
    throw new TypeError('resolve-browser-trace: set one of mapsDir, maps or loadMap')
  }
  if (mapsDir !== undefined && (typeof mapsDir !== 'string' || mapsDir === '')) {
    throw new TypeError('resolve-browser-trace: mapsDir must be a folder path')
  }
  if (maps !== undefined && (typeof maps !== 'object' || maps === null)) {
    throw new TypeError('resolve-browser-trace: maps must be an object of { "<bundle file name>": map }')
  }
  for (const [key, value] of Object.entries({ loadMap, onError })) {
    if (value !== undefined && typeof value !== 'function') {
      throw new TypeError(`resolve-browser-trace: ${key} must be a function`)
    }
  }
  return {
    mapsDir,
    maps,
    loadMap,
    onError,
    root: rootSegments(typeof root === 'string' ? root : ''),
    includeSource: includeSource === true,
    maxStackLength: positiveInteger(options, 'maxStackLength'),
    maxFrames: positiveInteger(options, 'maxFrames'),
    maxCachedMaps: positiveInteger(options, 'maxCachedMaps'),
    maxMapsPerStack: positiveInteger(options, 'maxMapsPerStack'),
    maxMapBytes: positiveInteger(options, 'maxMapBytes'),
  }
}

const MAX_NAME_LENGTH = 200

// What the browser calls a function is not always a name:
//   V8 "Object.emptyCheckout", "t.quote [as q]", "async fn", "new Foo"    -> emptyCheckout, quote, fn, Foo
//   Firefox "a/<" (anonymous inside a), "a/b<", "async*fn"                -> null, b, fn
//   "<anonymous>", "<unknown>", ""                                        -> null
// Plain string scanning, no backtracking regular expressions: the name is client text.
function cleanName(raw) {
  if (!raw) {
    return null
  }
  let name = raw.length > MAX_NAME_LENGTH ? raw.slice(0, MAX_NAME_LENGTH) : raw
  const alias = name.endsWith(']') ? name.lastIndexOf(' [as ') : -1
  if (alias !== -1) {
    name = name.slice(0, alias)
  }
  name = name.replace(/^(?:(?:async|new) )+/, '')
  name = name.slice(Math.max(name.lastIndexOf('.'), name.lastIndexOf('/'), name.lastIndexOf('*')) + 1)
  let end = name.length
  while (end > 0 && name[end - 1] === '<') {
    end--
  }
  name = sanitize(name.slice(0, end)).trim() // cutting at MAX_NAME_LENGTH can leave half an emoji
  return name === '' || name === '<anonymous>' || name === '<unknown>' ? null : name
}

// Finding line N walks the text, for every frame of every request, so a huge file gets no source line.
const MAX_SOURCE_TEXT = 500_000

function lineOf(content, line) {
  if (content.length > MAX_SOURCE_TEXT) {
    return null
  }
  let start = 0
  for (let n = 1; n < line; n++) {
    const newline = content.indexOf('\n', start)
    if (newline === -1) {
      return null
    }
    start = newline + 1
  }
  const end = content.indexOf('\n', start)
  return sanitize(content.slice(start, Math.min(end === -1 ? content.length : end, start + MAX_SOURCE_LINE)).replace(/\t/g, ' ')).trim()
}

function unmappedFrame(raw) {
  return {
    source: raw.file.replace(/[?#].*$/, '').trim() || null,
    line: raw.line,
    column: raw.column,
    name: cleanName(raw.name),
    arguments: [],
    mapped: false,
  }
}

/**
 * Creates a function that rebuilds a minified browser stack into original source locations.
 *
 * @param {string|object} options a maps directory, or { mapsDir, maps, loadMap, root, includeSource, onError, ... }
 * @returns {(stack: unknown) => Promise<Array<object>>}
 */
function createResolver(options) {
  const config = normalizeOptions(options)
  const store = createMapStore(config)

  function mapFrame(raw, map) {
    if (!map || raw.line === null || raw.line < 1 || raw.column === null || raw.column < 1) {
      return { frame: unmappedFrame(raw), callee: null }
    }
    // stack columns count from 1, source map columns from 0
    const position = originalPositionFor(map, { line: raw.line, column: raw.column - 1 })
    // a hostile map can point a mapping at a `sources` entry that does not exist, or hold numbers that are not numbers
    const source = typeof position.source === 'string' ? normalizeSource(position.source, config.root) : null
    // lines count from 1, columns from 0, and a hostile map can hold anything
    if (source === null || !Number.isSafeInteger(position.line) || position.line < 1 || !Number.isSafeInteger(position.column + 1) || position.column < 0) {
      return { frame: unmappedFrame(raw), callee: null }
    }
    const frame = {
      source,
      line: position.line,
      column: position.column + 1,
      name: cleanName(raw.name),
      arguments: [],
      mapped: true,
    }
    if (config.includeSource) {
      const content = sourceContentFor(map, position.source)
      // sourcesContent may be shorter than sources, or hold anything
      frame.sourceLine = typeof content === 'string' ? lineOf(content, position.line) : null
    }
    const callee = typeof position.name === 'string' ? sanitize(position.name.slice(0, MAX_NAME_LENGTH)).trim() : null
    return { frame, callee }
  }

  /**
   * @param {unknown} stack the text of `error.stack` (or React's `componentStack`) as sent by the browser
   * @returns {Promise<Array<object>>} never rejects; frames that cannot be mapped come back unmapped
   */
  return async function resolve(stack) {
    let raw = []
    if (typeof stack === 'string') {
      const text = stack.length > config.maxStackLength ? stack.slice(0, config.maxStackLength) : stack
      raw = parseStack(text, config)
    }
    const files = raw.map((frame) => bundleFileName(frame.file))
    const maps = new Map()
    // one stack may name any number of bundles, but at most maxMapsPerStack maps are opened for it
    const names = [...new Set(files)].filter(Boolean).slice(0, config.maxMapsPerStack)
    await Promise.all(names.map(async (name) => maps.set(name, await store.get(name))))
    const mapped = raw.map((frame, i) => mapFrame(frame, maps.get(files[i])))
    const frames = mapped.map(({ frame }) => frame)
    // A frame's source-map name is the identifier at its call position, i.e. the function the *caller* invoked.
    frames.forEach((frame, i) => {
      const callee = i + 1 < frames.length && frame.mapped && frames[i + 1].mapped ? mapped[i + 1].callee : null
      if (callee) {
        frame.name = callee
      }
    })
    Object.defineProperty(frames, 'stack', { value: formatStack(frames), enumerable: false })
    return frames
  }
}

createResolver.createResolver = createResolver
createResolver.setup = createResolver
createResolver.formatStack = formatStack
module.exports = createResolver
