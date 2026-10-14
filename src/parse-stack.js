'use strict'

// Parses the text of `error.stack` as produced by any mainstream engine into raw frames.
//
//   V8 (Chrome, Edge, Node, Bun):  "    at fn (https://host/app.js:1:301)"      "    at https://host/app.js:1:301"
//                                  "    at async fn (...)"  "    at new Foo (...)"  "    at Object.m [as alias] (...)"
//                                  "    at eval (eval at fn (https://host/app.js:1:2), <anonymous>:1:5)"
//   SpiderMonkey (Firefox):        "fn@https://host/app.js:1:301"   "a/<@..."   "async*fn@..."   "@https://host/app.js:1:301"
//   JavaScriptCore (Safari):       "fn@https://host/app.js:1:301"   "global code@..."   "map@[native code]"
//
// Everything that is not a frame (the "TypeError: message" header, blank lines, junk) is skipped. Nothing here throws.
// The caller bounds the input; MAX_LINE_LENGTH additionally keeps every regular expression below linear-ish.

const { sanitize } = require('./sanitize')

const MAX_LINE_LENGTH = 2000
// "eval at <fn> (<url>:<line>:<col>), <anonymous>:1:5" -> the place that called eval is the part a source map knows.
const EVAL_ORIGIN = /^eval at [^(]*\((.*?):(\d+):(\d+)\)(?:, .*)?$/
const WITH_COLUMN = /^(.*):(\d+):(\d+)$/
const WITH_LINE = /^(.*):(\d+)$/

// Digits that are not a safe integer ("1" followed by 400 more) are not a position.
const position = (digits) => (Number.isSafeInteger(+digits) ? +digits : null)

// "https://host/app.js:1:301" -> { file, line, column }; anything else is kept whole as the "file" ("<anonymous>", "native").
function parseLocation(location) {
  let match = EVAL_ORIGIN.exec(location)
  if (match) {
    // nested evals read "eval at a (eval at b (url", keep what follows the last "("
    return { file: match[1].slice(match[1].lastIndexOf('(') + 1), line: position(match[2]), column: position(match[3]) }
  }
  match = WITH_COLUMN.exec(location)
  if (match) {
    return { file: match[1], line: position(match[2]), column: position(match[3]) }
  }
  match = WITH_LINE.exec(location)
  if (match) {
    return { file: match[1], line: position(match[2]), column: null }
  }
  return { file: location, line: null, column: null }
}

function parseV8Frame(text) {
  const body = text.slice(3)
  let name = null
  let location = body.startsWith('async ') ? body.slice(6) : body
  const open = body.indexOf(' (')
  if (open !== -1 && body.endsWith(')')) {
    name = body.slice(0, open)
    location = body.slice(open + 2, -1)
  }
  const frame = parseLocation(location)
  // "at div" (a React component stack host element) or "at <anonymous>": nothing to point at.
  if (name === null && frame.line === null) {
    return null
  }
  frame.name = name
  return frame
}

function parseGeckoFrame(text) {
  const at = text.indexOf('@')
  if (at === -1) {
    return null
  }
  const frame = parseLocation(text.slice(at + 1))
  // "Error: mail me@example.com" is a message, not a frame; frames end in a line number or are native.
  if (frame.line === null && frame.file !== '[native code]') {
    return null
  }
  frame.name = text.slice(0, at)
  return frame
}

/**
 * @param {string} text
 * @param {{maxFrames: number}} limits
 * @returns {Array<{file: string, line: number|null, column: number|null, name: string|null}>}
 */
function parseStack(text, limits) {
  const frames = []
  const lines = text.split('\n')
  for (let i = 0; i < lines.length && frames.length < limits.maxFrames; i++) {
    const line = sanitize(lines[i]).trim()
    if (line.length === 0 || line.length > MAX_LINE_LENGTH) {
      continue
    }
    const frame = line.startsWith('at ') ? parseV8Frame(line) : parseGeckoFrame(line)
    if (frame) {
      frames.push(frame)
    }
  }
  return frames
}

module.exports = { parseStack }
