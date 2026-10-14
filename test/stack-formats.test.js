'use strict'

const createResolver = require('..')
const { recordedStacks } = require('./helpers')

// "Whatever browser the visitor has, the server understands its stack." No map is configured here, so every frame
// comes back unmapped and shows exactly how the stack text was read: script URL (query and fragment dropped), line,
// column, function name.
//
// Recorded: the Chrome, Edge, Firefox and Safari (WebKit) stacks in test/fixtures/stacks come from those browsers.
// Documented: the extra lines below that say so are written from the engines' documented formats, to cover shapes
// the fixtures do not happen to produce (eval origins, async frames, older Safari wording).

const resolve = createResolver({ maps: {} })
const frame = (source, line, column, name) => ({ source, line, column, name, arguments: [], mapped: false })

describe('Chrome, Edge, Node and Bun (V8 style: "at name (url:line:column)")', () => {
  test('recorded in Chrome: every frame of a real minified stack', async () => {
    const frames = await resolve(recordedStacks('chrome').variants.esbuild.blankRow)
    expect(frames.map((f) => [f.source.split('/').pop(), f.line, f.column])).toEqual([
      ['app-CQH66RKJ.js', 1, 678],
      ['app-CQH66RKJ.js', 1, 787],
      ['<anonymous>', null, null],
      ['app-CQH66RKJ.js', 1, 780],
      ['app-CQH66RKJ.js', 1, 1010],
      ['page', 6, 39],
    ])
    expect(frames.map((f) => f.name)).toEqual(['p', null, 'map', 'a', 'blankRow', '__run'])
  })

  test('recorded in Bun: "at <anonymous> (url)" and the native frame "at map (native:1:11)"', async () => {
    const frames = await resolve(recordedStacks('bun').variants.bun.blankRow)
    expect(frames.map((f) => f.name)).toEqual(['g', null, 'map', 'a', 'blankRow'])
    expect(frames[2]).toEqual(frame('native', 1, 11, 'map'))
  })

  test('documented: async, new, method aliases, native frames, eval origins, URLs with ports and query strings', async () => {
    const frames = await resolve(
      [
        'TypeError: x is not a function',
        '    at fn (https://h.example:8443/a.js?v=1#top:10:20)',
        '    at https://h/b.js:3:4',
        '    at async doIt (https://h/b.js:5:6)',
        '    at async https://h/b.js:7:8',
        '    at new Widget (https://h/c.js:7:8)',
        '    at Object.method [as alias] (https://h/d.js:9:10)',
        '    at Array.map (<anonymous>)',
        '    at async Promise.all (index 0)',
        '    at eval (eval at run (https://h/e.js:11:12), <anonymous>:1:5)',
        '    at eval (eval at a (eval at b (https://h/f.js:13:14), <anonymous>:2:3), <anonymous>:1:5)',
        '    at fn (C:\\proj\\g.js:15:16)',
        '    at Object.<anonymous> (https://h/h.js:17:18)',
        '    at https://h/i.js:19',
      ].join('\n')
    )
    expect(frames).toEqual([
      frame('https://h.example:8443/a.js', 10, 20, 'fn'),
      frame('https://h/b.js', 3, 4, null),
      frame('https://h/b.js', 5, 6, 'doIt'),
      frame('https://h/b.js', 7, 8, null),
      frame('https://h/c.js', 7, 8, 'Widget'),
      frame('https://h/d.js', 9, 10, 'method'),
      frame('<anonymous>', null, null, 'map'),
      frame('index 0', null, null, 'all'),
      frame('https://h/e.js', 11, 12, 'eval'),
      frame('https://h/f.js', 13, 14, 'eval'),
      frame('C:\\proj\\g.js', 15, 16, 'fn'),
      frame('https://h/h.js', 17, 18, null),
      frame('https://h/i.js', 19, null, null),
    ])
  })

  test('documented: lines that name no place ("at div" in a React component stack, a bare "at <anonymous>") are skipped', async () => {
    const frames = await resolve('\n    at div\n    at App (https://h/app.js:1:2)\n    at <anonymous>\n    at Suspense')
    expect(frames).toEqual([frame('https://h/app.js', 1, 2, 'App')])
  })
})

describe('Firefox (SpiderMonkey: "name@url:line:column")', () => {
  test('recorded in Firefox: anonymous callbacks print as "a/<" and the page frame has a name', async () => {
    const frames = await resolve(recordedStacks('firefox').variants.esbuild.blankRow)
    expect(frames.map((f) => f.name)).toEqual(['p', null, 'a', 'blankRow', '__run'])
    expect(frames[0]).toMatchObject({ source: 'http://localhost:43817/esbuild/app-CQH66RKJ.js', line: 1, column: 678 })
  })

  test('documented: async*, promise callback*, anonymous frames, nested names', async () => {
    const frames = await resolve(
      [
        'fn@https://h/a.js:10:20',
        '@https://h/b.js:3:4',
        'async*doIt@https://h/b.js:5:6',
        'promise callback*run@https://h/d.js:9:10',
        'outer/inner<@https://h/e.js:1:2',
        'outer/<@https://h/e.js:1:3',
        '<unknown>@https://h/e.js:1:4',
      ].join('\n')
    )
    expect(frames.map((f) => [f.source, f.line, f.column, f.name])).toEqual([
      ['https://h/a.js', 10, 20, 'fn'],
      ['https://h/b.js', 3, 4, null],
      ['https://h/b.js', 5, 6, 'doIt'],
      ['https://h/d.js', 9, 10, 'run'],
      ['https://h/e.js', 1, 2, 'inner'],
      ['https://h/e.js', 1, 3, null],
      ['https://h/e.js', 1, 4, null],
    ])
  })
})

describe('Safari (JavaScriptCore: "name@url:line:column")', () => {
  test('recorded in Safari: the page is an anonymous frame and Array.map is "map@[native code]"', async () => {
    const frames = await resolve(recordedStacks('webkit').variants.bun.blankRow)
    expect(frames.map((f) => f.name)).toEqual(['g', null, 'map', 'a', 'blankRow', null])
    expect(frames[2]).toEqual(frame('[native code]', null, null, 'map'))
  })

  test('documented: global code, eval code, module code and native frames', async () => {
    const frames = await resolve(
      ['global code@https://h/a.js:1:2', 'eval code@https://h/a.js:3:4', 'module code@https://h/m.js:5:6', 'eval@[native code]', 'forEach@[native code]'].join('\n')
    )
    expect(frames.map((f) => [f.source, f.line, f.column, f.name])).toEqual([
      ['https://h/a.js', 1, 2, 'global code'],
      ['https://h/a.js', 3, 4, 'eval code'],
      ['https://h/m.js', 5, 6, 'module code'],
      ['[native code]', null, null, 'eval'],
      ['[native code]', null, null, 'forEach'],
    ])
  })

  test('a Safari frame that has no line number is not guessed at', async () => {
    expect(await resolve('fn@https://h/a.js')).toEqual([])
  })
})

describe('React 19 component stacks', () => {
  test('the componentStack that onRecoverableError / onCaughtError / onUncaughtError receive resolves like any stack', async () => {
    const frames = await resolve('\n    at div\n    at Row (https://h/app.js:4:5)\n    at ul\n    at CartView (https://h/app.js:6:7)\n    at App')
    expect(frames.map((f) => [f.name, f.line])).toEqual([['Row', 4], ['CartView', 6]])
  })
})

describe('a stack with windows line endings, tabs and indentation of any size', () => {
  test('is read the same', async () => {
    const frames = await resolve('Error: x\r\n\tat a (https://h/a.js:1:2)\r\n        at b (https://h/a.js:3:4)\r\n')
    expect(frames.map((f) => f.name)).toEqual(['a', 'b'])
  })
})

describe('a stack whose lines end in a lone carriage return (old Mac style)', () => {
  test('is read line by line', async () => {
    const frames = await resolve('Error: x\r    at a (https://h/a.js:1:2)\r    at b (https://h/a.js:3:4)')
    expect(frames.map((f) => f.name)).toEqual(['a', 'b'])
  })
})
