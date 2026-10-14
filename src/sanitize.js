'use strict'

// Text from a browser, and text from a source map, ends up in log lines. Control characters (C0/C1, \r, \n, ANSI
// escapes), line and paragraph separators, and every "format" character (bidi marks and isolates, zero-width
// marks, soft hyphen, tag characters, byte order mark) never belong in a frame: they could fake another frame,
// reorder or hide text, or rewrite a terminal. Lone surrogates (what cutting a string in the middle of an emoji
// leaves) are removed too: they break encodeURIComponent and UTF-8 encoders.
// plus the blank-looking letters and marks that are not "format" characters: Hangul fillers, Braille blank,
// Khmer inherent vowels, the combining grapheme joiner and variation selectors.
const UNSAFE = /[\p{Cc}\p{Cf}\p{Cs}\p{Zl}\p{Zp}\u034f\u115f\u1160\u17b4\u17b5\u2800\u3164\uffa0\ufe00-\ufe0f]/gu

/**
 * @param {string} text
 * @returns {string} text without control and direction-changing characters
 */
function sanitize(text) {
  return text.replace(UNSAFE, '')
}

module.exports = { sanitize }
