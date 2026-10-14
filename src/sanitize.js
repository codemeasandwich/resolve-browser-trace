'use strict'

// Text from a browser, and text from a source map, ends up in log lines. Control characters (C0/C1, \r, \n, ANSI
// escapes), line and paragraph separators, and every "format" character (bidi marks and isolates, zero-width
// marks, soft hyphen, tag characters, byte order mark) never belong in a frame: they could fake another frame,
// reorder or hide text, or rewrite a terminal. Lone surrogates (what cutting a string in the middle of an emoji
// leaves) are removed too: they break encodeURIComponent and UTF-8 encoders.
// Default_Ignorable_Code_Point is Unicode's own list of characters that render as nothing: it adds the ones that are
// not "format" characters (Hangul fillers, Khmer inherent vowels, the combining grapheme joiner, Mongolian and
// all variation selectors, including U+E0100-E01EF) and follows new Unicode versions. Braille blank (U+2800) is
// not on that list but is blank-looking, so it is listed here.
const UNSAFE = /[\p{Cc}\p{Cf}\p{Cs}\p{Zl}\p{Zp}\p{Default_Ignorable_Code_Point}\u2800]/gu

/**
 * @param {string} text
 * @returns {string} text without control and direction-changing characters
 */
function sanitize(text) {
  return text.replace(UNSAFE, '')
}

module.exports = { sanitize }
