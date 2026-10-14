'use strict'

/**
 * Rebuilds a readable, V8-style stack from resolved frames:
 *   "    at validateCart (src/lib/cart.ts:9:11)"
 * Only the frames are rendered; the "Error: message" header is not part of a frame and is left to the caller.
 * @param {Array<{source: string|null, line: number|null, column: number|null, name: string|null}>} frames
 * @returns {string}
 */
function formatStack(frames) {
  return frames
    .map(({ source, line, column, name }) => {
      let where = source === null ? '<anonymous>' : source
      if (line !== null) {
        where += `:${line}`
        if (column !== null) {
          where += `:${column}`
        }
      }
      return name ? `    at ${name} (${where})` : `    at ${where}`
    })
    .join('\n')
}

module.exports = { formatStack }
