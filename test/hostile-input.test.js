'use strict'

const fs = require('node:fs')
const createResolver = require('..')
const { PROJECT_ROOT, mapsDir, bundle, recordedStacks } = require('./helpers')

// "A hostile or broken client must not be able to crash, stall or fill the server." The stack text is sent by the
// visitor's browser, so it can be anything. The resolver must never throw and never reject.

const esbuildFile = bundle('esbuild', 'app-')
const realStack = recordedStacks('chrome').variants.esbuild.emptyCheckout
const resolve = createResolver({ mapsDir: mapsDir('esbuild'), root: PROJECT_ROOT })

describe('input that is not stack text', () => {
  test.each([
    ['undefined', undefined],
    ['null', null],
    ['a number', 42],
    ['NaN', NaN],
    ['a boolean', true],
    ['an object', { stack: realStack }],
    ['an Error', new Error('boom')],
    ['an array of lines', realStack.split('\n')],
    ['a function', () => realStack],
    ['a symbol', Symbol('x')],
    ['a bigint', 10n],
    ['a Buffer', Buffer.from(realStack)],
    ['an object whose toString throws', { toString: () => { throw new Error('nope') } }],
  ])('%s resolves to an empty list', async (_, input) => {
    await expect(resolve(input)).resolves.toEqual([])
  })

  test('no argument at all resolves to an empty list', async () => {
    await expect(resolve()).resolves.toEqual([])
  })

  test.each([
    ['an empty string', ''],
    ['only whitespace', '  \n\t\r\n  '],
    ['only an error header', 'TypeError: x is not a function'],
    ['a stack header with an @ in the message', 'Error: mail me@example.com about it'],
    ['an HTML page', '<html><body>at least one <b>at</b> thing</body></html>'],
    ['binary junk', Buffer.from(Array.from({ length: 5000 }, (_, i) => (i * 37) % 256)).toString('latin1')],
    ['null bytes', 'at a (https://h/a.js:1:2)\u0000\u0000\n\u0000'],
    ['JSON text', '{"stack":"at a (https://h/a.js:1:2)"}'],
  ])('%s gives no frames, or only the real ones, and no error', async (_, input) => {
    const frames = await resolve(input)
    expect(Array.isArray(frames)).toBe(true)
    expect(frames.length).toBeLessThanOrEqual(1)
  })
})

describe('frames that are damaged', () => {
  const base = createResolver({ maps: {} })

  test('the old crash: a frame with no function name and no map no longer throws', async () => {
    const frames = await base('@https://localhost/main-9adc196540168f060d54.min.js:1:3385\n@https://localhost/main-9adc196540168f060d54.min.js:1:96')
    expect(frames).toEqual([
      { source: 'https://localhost/main-9adc196540168f060d54.min.js', line: 1, column: 3385, name: null, arguments: [], mapped: false },
      { source: 'https://localhost/main-9adc196540168f060d54.min.js', line: 1, column: 96, name: null, arguments: [], mapped: false },
    ])
  })

  test.each([
    ['a missing column', 'at f (https://h/app.js:7)', [7, null]],
    ['a column of zero', 'at f (https://h/app.js:7:0)', [7, 0]],
    ['no position', 'at f (https://h/app.js)', [null, null]],
    ['an absurd line number', 'at f (https://h/app.js:99999999999999999999:5)', [null, 5]],
    ['a line number of zero', 'at f (https://h/app.js:0:5)', [0, 5]],
    ['a column with 400 digits', `at f (https://h/app.js:7:${'9'.repeat(400)})`, [7, null]],
    ['an empty location', 'at f ()', [null, null]],
    ['a line cut off in the middle of its parentheses', 'at f (https://h/app.js:7:8', [7, 8]],
  ])('%s is returned as an unmapped frame', async (_, line, [lineNumber, column]) => {
    const withMap = createResolver({ maps: { 'app.js': JSON.parse(require('node:fs').readFileSync(`${mapsDir('esbuild')}/${esbuildFile}.map`, 'utf8')) } })
    const [frame] = await withMap(line)
    expect(frame.mapped).toBe(false)
    expect([frame.line, frame.column]).toEqual([lineNumber, column])
  })

  test('a line number far outside the file maps to nothing and stays unmapped', async () => {
    const [frame] = await resolve(`    at f (https://h/${esbuildFile}:99999:99999)`)
    expect(frame.mapped).toBe(false)
  })
})

describe('input that is enormous', () => {
  test('a megabyte of frames returns at most maxFrames frames, quickly', async () => {
    const line = `    at fn (https://shop.example.com/assets/${esbuildFile}:1:301)\n`
    const started = Date.now()
    const frames = await resolve(line.repeat(Math.ceil(1_000_000 / line.length)))
    expect(frames).toHaveLength(100)
    expect(Date.now() - started).toBeLessThan(2000)
  })

  test('maxFrames is configurable', async () => {
    const frames = await createResolver({ maps: {}, maxFrames: 3 })(realStack)
    expect(frames).toHaveLength(3)
  })

  test('only the first maxStackLength characters are read, and a frame cut in half is not guessed at', async () => {
    const first = '    at a (https://h/a.js:1:2)\n'
    const second = '    at b (https://h/a.js:3:4)\n'
    const small = createResolver({ maps: {}, maxStackLength: first.length + 10 })
    expect((await small(first + second)).map((f) => f.name)).toEqual(['a'])
    const exact = createResolver({ maps: {}, maxStackLength: (first + second).length })
    expect((await exact(first + second)).map((f) => f.name)).toEqual(['a', 'b'])
  })

  test('a single line of thousands of characters is ignored and the frames after it are still read', async () => {
    const frames = await resolve(`    at f (https://h/${'a'.repeat(5000)}.js:1:2)\n${realStack}`)
    expect(frames.map((f) => f.mapped)).toEqual([true, true, true, false])
  })

  test('a stack longer than the default limit is cut, and what is cut is not an error', async () => {
    const frames = await resolve(`${realStack}\n${'x'.repeat(1_000_000)}\n    at late (https://h/a.js:1:2)`)
    expect(frames.map((f) => f.name)).not.toContain('late')
    expect(frames).toHaveLength(4)
  })

  test('lines built to make a regular expression backtrack finish at once', async () => {
    const nasty = [
      `    at ${'('.repeat(900)} ${'a:1:'.repeat(120)}`,
      `    at x (eval at ${'a ('.repeat(200)}:1:1`,
      `${'@'.repeat(1900)}`,
      `    at ${' ('.repeat(900)}`,
      `    at eval (eval at f (${':1'.repeat(900)}`,
    ].join('\n')
    const started = Date.now()
    await resolve(nasty.repeat(20))
    expect(Date.now() - started).toBeLessThan(2000)
  })

  test('a stack of ten thousand distinct bundle names opens at most maxCachedMaps maps', async () => {
    const asked = []
    const guarded = createResolver({ loadMap: (name) => asked.push(name) && null })
    const stack = Array.from({ length: 10000 }, (_, i) => `    at f (https://h/fake-${i}.js:1:1)`).join('\n')
    expect(await guarded(stack)).toHaveLength(100)
    expect(asked).toHaveLength(16) // as many maps as the cache holds (maxCachedMaps), however many bundles the stack names
  })
})

describe('many resolves at once', () => {
  test('a hundred parallel resolves of a real stack all agree', async () => {
    const results = await Promise.all(Array.from({ length: 100 }, () => resolve(realStack)))
    for (const frames of results) {
      expect(frames.slice(0, 3).map((f) => f.source)).toEqual(['src/lib/cart.ts', 'src/lib/cart.ts', 'src/app.tsx'])
    }
  })
})

describe('a stack naming many real bundles', () => {
  test('opens no more maps than the cache holds, so memory stays bounded; the other frames stay unmapped', async () => {
    let opened = 0
    const map = fs.readFileSync(`${mapsDir('esbuild')}/${esbuildFile}.map`, 'utf8')
    const guarded = createResolver({ loadMap: () => (opened++, map), maxCachedMaps: 4 })
    const stack = Array.from({ length: 100 }, (_, i) => `    at f (https://h/chunk-${i}.js:1:301)`).join('\n')
    const frames = await guarded(stack)
    expect(opened).toBe(4)
    expect(frames.filter((f) => f.mapped)).toHaveLength(4)
  })
})

describe('text that tries to slow the resolver down', () => {
  const timed = async (stack) => {
    const started = process.hrtime.bigint()
    await createResolver({ maps: {} })(stack)
    return Number(process.hrtime.bigint() - started) / 1e6
  }

  test.each([
    ['a Firefox name that is almost all "<"', `${'<'.repeat(1960)}x@x.js:1:1\n`.repeat(33)],
    ['a V8 name that is almost all "<"', `at ${'<'.repeat(1965)}x (x.js:1:1)\n`.repeat(33)],
    ['a name that repeats " [as "', `at ${'[as '.repeat(400)}x (x.js:1:1)\n`.repeat(40)],
    ['a name that repeats "async "', `at ${'async '.repeat(300)}x (x.js:1:1)\n`.repeat(40)],
  ])('%s is handled in linear time', async (_, stack) => {
    expect(await timed(stack)).toBeLessThan(150)
  })
})

describe('control characters in the stack', () => {
  test('cannot forge a second frame or rewrite a terminal through names, files or the rebuilt stack', async () => {
    const frames = await createResolver({ maps: {} })('at ev\u2028il\u001b[2K\r    at forged (src/auth.ts:1:1) (https://h/a.js:1:2)')
    expect(frames).toHaveLength(1)
    expect(frames.stack).not.toMatch(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/)
    expect(frames.stack.split('\n')).toHaveLength(1)
  })
})

describe('maps and callbacks that misbehave', () => {
  const map = JSON.parse(fs.readFileSync(`${mapsDir('esbuild')}/${esbuildFile}.map`, 'utf8'))

  test.each([
    ['fewer sourcesContent entries than sources', { ...map, sourcesContent: [] }],
    ['a sourcesContent entry that is not text', { ...map, sourcesContent: map.sources.map(() => 42) }],
  ])('includeSource with %s gives null source lines, not a rejection', async (_, broken) => {
    const frames = await createResolver({ maps: { [esbuildFile]: broken }, includeSource: true })(realStack)
    expect(frames[0]).toMatchObject({ mapped: true, sourceLine: null })
  })

  test('an async onError that rejects does not become an unhandled rejection', async () => {
    const unhandled = []
    const listener = (reason) => unhandled.push(reason)
    process.on('unhandledRejection', listener)
    const resolveBroken = createResolver({ maps: { [esbuildFile]: 'not a map' }, onError: async () => { throw new Error('logger down') } })
    await resolveBroken(realStack)
    await new Promise((r) => setTimeout(r, 20))
    process.off('unhandledRejection', listener)
    expect(unhandled).toEqual([])
  })

  test('a map file that starts with a byte order mark is read', async () => {
    const frames = await createResolver({ maps: { [esbuildFile]: `\ufeff${JSON.stringify(map)}` } })(realStack)
    expect(frames[0].mapped).toBe(true)
  })
})

describe('bundle names a file system would refuse or treat specially', () => {
  test.each([
    ['a name too long for "<name>.map"', `${'a'.repeat(250)}.js`],
    ['a Windows device name', 'con.js'],
    ['another Windows device name, upper case', 'NUL.js'],
    ['a numbered Windows device name', 'com1.js'],
  ])('%s is never looked up and never reported as an error', async (_, name) => {
    const asked = []
    const errors = []
    const dir = createResolver({ mapsDir: mapsDir('esbuild'), loadMap: (n) => asked.push(n) && null, onError: (e) => errors.push(e) })
    expect((await dir(`    at f (https://h/${name}:1:5)`))[0].mapped).toBe(false)
    expect(asked).toEqual([])
    expect(errors).toEqual([])
  })

  test('a name that merely starts like a device name is fine', async () => {
    const asked = []
    await createResolver({ loadMap: (n) => asked.push(n) && null })('    at f (https://h/console.js:1:5)\n    at g (https://h/connect.min.js:1:5)')
    expect(asked).toEqual(['console.js', 'connect.min.js'])
  })
})
