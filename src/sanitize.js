'use strict'

// Text from a browser, and text from a source map, ends up in log lines. Control characters (C0/C1, \r, \n, ANSI
// escapes, line and paragraph separators) and the characters that reorder or hide text (bidi marks and isolates,
// zero-width marks, byte order mark) never belong in a frame: they could fake another frame or rewrite a terminal.
const UNSAFE = /[\u0000-\u001f\u007f-\u009f\u061c\u200b-\u200f\u2028-\u202e\u2066-\u2069\ufeff]/g

/**
 * @param {string} text
 * @returns {string} text without control and direction-changing characters
 */
function sanitize(text) {
  return text.replace(UNSAFE, '')
}

module.exports = { sanitize }
