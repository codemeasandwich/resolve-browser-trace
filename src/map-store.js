'use strict'

const fs = require('node:fs')
const path = require('node:path')
const { TraceMap, decodedMappings } = require('@jridgewell/trace-mapping')

// Finds, loads and caches the source map for a bundle file name.
//
// A bundle's file name comes from a client-supplied stack, so it is hostile text:
//  - it must look like a plain script file name (no separators, so it can never leave `mapsDir`),
//  - only real, successfully parsed maps are cached, in a small LRU (a page cannot grow memory with fake names),
//  - concurrent requests for the same bundle share one load.
// get() never rejects: a map that is missing, unreadable or broken is `null` (broken ones are reported to onError).

// "app-1a2b3c.js", "chunk-QMLZOCCF.js", "main.5f3e.chunk.js", "index-BzS2xa1Q.js", "worker.mjs": a script file name and
// nothing else (no slash, no "..", no HTML page that holds an inline script).
// Short enough for "<name>.map" to fit a file system, and not a Windows device name (con.js, nul.js, ...).
const SAFE_FILE_NAME = /^(?!(?:con|prn|aux|nul|com\d|lpt\d)\.)[\w.@+~=,-]{1,240}\.(?:m|c)?js$/i

/**
 * "https://shop.example/assets/app-1a2b.js?v=3#x" -> "app-1a2b.js"; null when it is not a plain file name.
 * @param {string} file the file part of a stack frame
 * @returns {string|null}
 */
function bundleFileName(file) {
  const withoutQuery = file.split(/[?#]/, 1)[0]
  const name = withoutQuery.slice(withoutQuery.lastIndexOf('/') + 1)
  return SAFE_FILE_NAME.test(name) ? name : null
}

// Decoding allocates an array per generated line, so a map of nothing but ";" is a memory bomb at any byte size.
const MAX_GENERATED_LINES = 2_000_000

function toTraceMap(raw, maxMapBytes) {
  if (raw instanceof Uint8Array) {
    raw = Buffer.from(raw).toString('utf8')
  }
  if (typeof raw === 'string' && raw.length > maxMapBytes) {
    throw new RangeError(`source map is larger than maxMapBytes (${maxMapBytes})`)
  }
  if (typeof raw === 'string') {
    raw = JSON.parse(raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw) // a byte order mark may precede the JSON
  }
  if (typeof raw !== 'object' || raw === null) {
    throw new TypeError('a source map must be a JSON string, a Buffer or an object')
  }
  if (typeof raw.mappings === 'string' && (raw.mappings.length > maxMapBytes || raw.mappings.split(';', MAX_GENERATED_LINES + 1).length > MAX_GENERATED_LINES)) {
    throw new RangeError('source map has too many bytes or lines')
  }
  const map = new TraceMap(raw)
  decodedMappings(map) // decode now, while loading, so no lookup pays for it and a map that cannot be decoded fails here
  return map
}

function readMapFile(file) {
  return fs.promises.readFile(file, 'utf8').catch((error) => {
    if (error.code === 'ENOENT' || error.code === 'ENOTDIR') {
      return null
    }
    throw error
  })
}

/**
 * @param {{mapsDir?: string, maps?: object, loadMap?: Function, maxCachedMaps: number, maxMapBytes: number, onError?: Function}} options
 */
function createMapStore(options) {
  const { mapsDir, maps, loadMap, maxCachedMaps, maxMapBytes, onError } = options
  const cache = new Map()
  const loading = new Map()

  async function fetchRaw(name) {
    if (maps && Object.prototype.hasOwnProperty.call(maps, name)) {
      return maps[name]
    }
    if (loadMap) {
      const loaded = await loadMap(name)
      if (loaded != null) {
        return loaded
      }
    }
    return mapsDir ? readMapFile(path.join(mapsDir, `${name}.map`)) : null
  }

  async function load(name) {
    try {
      const raw = await fetchRaw(name)
      if (raw == null) {
        return null
      }
      const map = toTraceMap(raw, maxMapBytes)
      cache.set(name, map)
      if (cache.size > maxCachedMaps) {
        cache.delete(cache.keys().next().value)
      }
      return map
    } catch (error) {
      try {
        if (onError) {
          // Promise.resolve: an async onError that rejects must not become an unhandled rejection either
          Promise.resolve(onError(error, { file: name })).catch(() => {})
        }
      } catch {
        // a throwing logger must not turn a bad map into a rejected resolve
      }
      return null
    }
  }

  return {
    /** @returns {Promise<import('@jridgewell/trace-mapping').TraceMap|null>} */
    get(name) {
      const cached = cache.get(name)
      if (cached) {
        cache.delete(name)
        cache.set(name, cached) // most recently used goes last
        return Promise.resolve(cached)
      }
      if (!loading.has(name)) {
        loading.set(name, load(name).finally(() => loading.delete(name)))
      }
      return loading.get(name)
    },
  }
}

module.exports = { createMapStore, bundleFileName }
