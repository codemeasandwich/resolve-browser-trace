'use strict'

// Turns the `sources` entries of a source map into short project-relative paths and never an absolute server path.
//
//   webpack:///./src/app.js          -> src/app.js
//   webpack://shop/./src/app.js?1a2b -> src/app.js
//   ../../src/lib/cart.ts            -> src/lib/cart.ts        (relative to the bundler's output folder)
//   /Users/ci/build/shop/src/a.ts    -> src/a.ts               (with root '/Users/ci/build/shop'; see below)
//   file:///Users/ci/build/shop/x.ts -> ...
//
// A Windows drive ("C:\...", "c:foo") or a scheme other than webpack: marks an absolute path. Anything inside
// node_modules is cut to node_modules/<package>/... Paths that were absolute or climbed out of the output folder
// ("environment paths") are made relative to `root` when they sit under it. Otherwise they are cut down to src/...
// (from the last "src" folder), or their last two segments. Nothing that comes back starts with "/" or a
// drive letter, and none of its segments is "..", "." or blank.

const { sanitize } = require('./sanitize')

// A source name longer than this is cut to its tail: nothing real is longer, and it bounds the work and the output.
const MAX_SOURCE_LENGTH = 1000

// "webpack:///x", "webpack://name/x", "vm:/x": two or more letters then a colon and a slash ("C:" is a drive, and
// "app:main.ts" is just a name)
const SCHEME = /^([a-z][a-z0-9+.-]+):(\/\/[^/]*\/?|\/)/i
// "C:", "c:c:" (repeated, so stripping once can not leave one behind)
const DRIVE_PREFIX = /^(?:[a-z]:)+/i
const DRIVE_SEGMENT = /^[a-z]:$/i
// Schemes whose paths are project-relative; for any other scheme (file:, vm:, ...) the path is the machine's.
const PROJECT_SCHEMES = new Set(['webpack', 'webpack-internal', 'turbopack', 'ng'])

// "a/./b/../c" -> ['a', 'c']; `climbed` is true when a ".." had nothing left to remove (the path left its base folder).
function splitPath(path) {
  const segments = []
  let climbed = false
  let drive = false
  for (const part of path.split('/')) {
    let segment = part.trim()
    if (DRIVE_SEGMENT.test(segment)) {
      drive = true // "C:" in the middle of a path ("./C:/Users/x.ts"); a drive is never part of a returned path
      continue
    }
    if (segments.length === 0 && DRIVE_PREFIX.test(segment)) {
      drive = true // "/C:foo/x.ts": a drive-relative name first in the path
      segment = segment.replace(DRIVE_PREFIX, '').trim()
    }
    const withoutDrive = segment
    if (withoutDrive === '..') {
      if (segments.length === 0) {
        climbed = true
      } else {
        segments.pop()
      }
    } else if (!/^[.\s]*$/.test(withoutDrive)) {
      segments.push(withoutDrive)
    }
  }
  return { segments, climbed, drive }
}

// The last word: whatever the rules above produced, what is returned never starts with a slash, blank or drive
// prefix, and has no "..", "." or blank segment. Repeats until nothing changes (stripping one thing can expose another).
function finish(segments) {
  let joined = segments.join('/')
  for (;;) {
    const next = splitPath(joined.replace(/^[\s/\\]+/, '').replace(DRIVE_PREFIX, '')).segments.join('/')
    if (next === joined) {
      return joined === '' ? null : joined
    }
    joined = next
  }
}

/**
 * Pure string work; nothing is resolved on disk.
 * @param {string} root absolute project root (any slash style), or ''
 * @returns {string[]} the root as path segments
 */
function rootSegments(root) {
  return splitPath(root.replace(/\\/g, '/').replace(DRIVE_PREFIX, '')).segments
}

/**
 * @param {string} raw one entry of a source map's `sources`
 * @param {string[]} root result of rootSegments()
 * @returns {string|null}
 */
function normalizeSource(raw, root) {
  let path = sanitize(raw.length > MAX_SOURCE_LENGTH ? raw.slice(-MAX_SOURCE_LENGTH) : raw).replace(/\\/g, '/')
  let environment = false
  const scheme = SCHEME.exec(path)
  if (scheme) {
    // a project scheme with a single slash ("webpack:/Users/..") is not the usual form: treat its path as the machine's
    environment = !PROJECT_SCHEMES.has(scheme[1].toLowerCase()) || scheme[2] === '/'
    path = path.slice(scheme[0].length)
  }
  const query = path.search(/[?#]/)
  path = query === -1 ? path : path.slice(0, query)
  if (DRIVE_PREFIX.test(path) || path.startsWith('/')) {
    environment = true
  }
  path = path.replace(DRIVE_PREFIX, '').trim().replace(/^\/@fs\//, '/') // "/@fs/" is how Vite names files outside its root
  const { segments, climbed, drive } = splitPath(path)
  environment = environment || drive
  const modules = segments.indexOf('node_modules')
  if (modules !== -1) {
    return finish(segments.slice(modules))
  }
  if (!environment && !climbed) {
    return finish(segments)
  }
  if (root.length > 0 && root.length < segments.length && root.every((part, i) => part === segments[i])) {
    return finish(segments.slice(root.length))
  }
  const src = segments.lastIndexOf('src')
  if (src !== -1 && src < segments.length - 1) {
    return finish(segments.slice(src))
  }
  return finish(segments.slice(-2))
}

module.exports = { normalizeSource, rootSegments }
