'use strict'

// Turns the `sources` entries of a source map into short project-relative paths and never an absolute server path.
//
//   webpack:///./src/app.js          -> src/app.js
//   webpack://shop/./src/app.js?1a2b -> src/app.js
//   ../../src/lib/cart.ts            -> src/lib/cart.ts        (relative to the bundler's output folder)
//   /Users/ci/build/shop/src/a.ts    -> src/a.ts               (with root '/Users/ci/build/shop'; see below)
//   file:///Users/ci/build/shop/x.ts -> ...
//
// Anything inside node_modules is cut to node_modules/<package>/... Paths that were absolute or climbed out of
// the output folder ("environment paths") are made relative to `root` when they sit under it. Otherwise they are
// cut down to src/... (from the last "src" folder), or their last two segments. Nothing that comes back starts
// with "/", "..", or a drive letter.

const SCHEME = /^([a-z][a-z0-9+.-]*):\/\/[^/]*\/?/i
const DRIVE_PREFIX = /^[a-z]:(?=\/|$)/i

// "a/./b/../c" -> ['a', 'c']; `climbed` is true when a ".." had nothing left to remove (the path left its base folder).
function splitPath(path) {
  const segments = []
  let climbed = false
  for (const segment of path.split('/')) {
    if (segment === '..') {
      if (segments.length === 0) {
        climbed = true
      } else {
        segments.pop()
      }
    } else if (segment !== '' && segment !== '.') {
      segments.push(segment)
    }
  }
  return { segments, climbed }
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
  let path = raw.replace(/\\/g, '/')
  let environment = false
  const scheme = SCHEME.exec(path)
  if (scheme) {
    environment = scheme[1].toLowerCase() === 'file'
    path = path.slice(scheme[0].length)
  }
  path = path.replace(/[?#].*$/, '')
  if (DRIVE_PREFIX.test(path) || path.startsWith('/')) {
    environment = true
  }
  path = path.replace(DRIVE_PREFIX, '').replace(/^\/@fs\//, '/') // "/@fs/" is how Vite names files outside its root
  const { segments, climbed } = splitPath(path)
  if (segments.length === 0) {
    return null
  }
  const modules = segments.indexOf('node_modules')
  if (modules !== -1) {
    return segments.slice(modules).join('/')
  }
  if (!environment && !climbed) {
    return segments.join('/')
  }
  if (root.length > 0 && root.length < segments.length && root.every((part, i) => part === segments[i])) {
    return segments.slice(root.length).join('/')
  }
  const src = segments.lastIndexOf('src')
  if (src !== -1 && src < segments.length - 1) {
    return segments.slice(src).join('/')
  }
  return segments.slice(-2).join('/')
}

module.exports = { normalizeSource, rootSegments }
