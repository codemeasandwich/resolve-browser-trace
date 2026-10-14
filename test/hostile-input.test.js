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

  test('a stack of ten thousand distinct bundle names opens at most maxMapsPerStack maps', async () => {
    const asked = []
    const guarded = createResolver({ loadMap: (name) => asked.push(name) && null })
    const stack = Array.from({ length: 10000 }, (_, i) => `    at f (https://h/fake-${i}.js:1:1)`).join('\n')
    expect(await guarded(stack)).toHaveLength(100)
    expect(asked).toHaveLength(4) // maxMapsPerStack, however many bundles the stack names
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
  test('opens no more maps than maxMapsPerStack, so one request cannot parse or hold many; the other frames stay unmapped', async () => {
    let opened = 0
    const map = fs.readFileSync(`${mapsDir('esbuild')}/${esbuildFile}.map`, 'utf8')
    const guarded = createResolver({ loadMap: () => (opened++, map), maxMapsPerStack: 4 })
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

describe('maps that load but are hostile inside', () => {
  const oneFrame = '    at f (https://h/app.js:1:5)\n    at g (https://h/app.js:1:5)'
  const map = (extra) => JSON.stringify({ version: 3, sources: ['src/a.ts'], names: [], mappings: 'AAAAA', ...extra })

  test.each([
    ['a names entry whose toString is not callable', map({ names: [{ toString: 1 }] })],
    ['a decoded mappings array holding a null segment', map({ mappings: [[null]] })],
    ['a segment whose line is an object', map({ mappings: [[[0, 0, { toString: 1 }, 0]]] })],
    ['a numeric names entry', map({ names: [5] })],
    ['an array names entry', map({ names: [['a', 'b']] })],
    ['string line and column numbers', map({ mappings: [[[0, 0, '01', '01']]] })],
    ['a sources entry that is an object', map({ sources: [{}] })],
    ['a sourceRoot that is not text', map({ sourceRoot: 5 })],
  ])('%s: resolves with frames whose fields are the documented types', async (_, text) => {
    for (const includeSource of [false, true]) {
      const frames = await createResolver({ maps: { 'app.js': text }, includeSource })(oneFrame)
      expect(frames).toHaveLength(2)
      for (const f of frames) {
        expect(typeof f.source === 'string' || f.source === null).toBe(true)
        expect(typeof f.name === 'string' || f.name === null).toBe(true)
        expect(f.line === null || Number.isSafeInteger(f.line)).toBe(true)
        expect(f.column === null || Number.isSafeInteger(f.column)).toBe(true)
      }
      expect(typeof frames.stack).toBe('string')
    }
  })

  test('text a map supplies (path, function name, source line) cannot forge frames or direction changes either', async () => {
    const evil = '\n    at forged (src/auth.ts:1:1)\u202e\u001b[2K'
    const text = JSON.stringify({ version: 3, sources: [`src/a.ts${evil}`], names: [`x${evil}`], mappings: 'AAAAA', sourcesContent: [`one${evil}`] })
    const frames = await createResolver({ maps: { 'app.js': text }, includeSource: true })(oneFrame)
    expect(frames[0].source).toBe('src/a.ts    at forged (src/auth.ts:1:1)[2K')
    expect(frames.stack.split('\n')).toHaveLength(2)
    expect(frames[0].sourceLine).not.toMatch(/[\u0000-\u001f\u202e]/)
    expect(frames[0].name).not.toMatch(/[\u0000-\u001f\u202e]/)
  })

  test('direction-changing and zero-width characters in the stack are removed too', async () => {
    const frames = await createResolver({ maps: {} })('at a\u202eb\u200bc (https://h/a\u2066.js:1:2)')
    expect(frames[0].name).toBe('abc')
    expect(frames[0].source).toBe('https://h/a.js')
  })
})

describe('maps whose names are huge, disguised or bombs', () => {
  const stack100 = Array.from({ length: 100 }, () => '    at f (https://h/app.js:1:1)').join('\n')
  const sourceMap = (source, extra) => ({ version: 3, sources: [source], names: [], mappings: 'AAAA', ...extra })
  const first = async (source) => (await createResolver({ maps: { 'app.js': sourceMap(source) } })('    at f (https://h/app.js:1:1)'))[0]

  test('a 3000-character source name on a 100-frame stack resolves, with a short source', async () => {
    const frames = await createResolver({ maps: { 'app.js': sourceMap('a'.repeat(3000)) } })(stack100)
    expect(frames).toHaveLength(100)
    expect(frames[0].source.length).toBeLessThanOrEqual(1000)
    expect(frames.stack.length).toBeLessThan(200000)
  })

  test('a 6 MB source name is refused with the map, and the stack still resolves', async () => {
    const frames = await createResolver({ maps: { 'app.js': sourceMap('a'.repeat(6e6)) } })(stack100)
    expect(frames).toHaveLength(100)
    expect(frames[0].mapped).toBe(false)
  })

  test('a source of 80000 "?" and a newline does not stall the event loop', async () => {
    const started = Date.now()
    await first(`${'?'.repeat(80000)}\n`)
    expect(Date.now() - started).toBeLessThan(500)
  })

  test.each([
    ['a zero-width space before a root', '\u200b/Users/ci/build/shop/src/a.ts', 'src/a.ts'],
    ['zero-width spaces inside dot-dot', '.\u200b./.\u200b./etc/passwd', 'etc/passwd'],
    ['a control character before a root', '\u0001/etc/passwd', 'etc/passwd'],
    ['a zero-width space inside a drive', 'C\u200b:/Users/x/y.ts', 'x/y.ts'],
    ['a soft hyphen and tag characters', '/Users/ci/s\u00adrc/a.ts\u{e0041}', 'src/a.ts'],
    ['a newline after a query mark', 'a?x\n/Users/ci/y', 'a'],
  ])('%s cannot smuggle an absolute path past the cleaning', async (_, source, expected) => {
    const frame = await first(source)
    expect(frame.source).toBe(expected)
    expect(frame.source).not.toMatch(/^([/\\]|[A-Za-z]:|\.\.)/)
  })

  test.each([['only invisible characters', '\u0001\u200b'], ['dot-dot', '\u200b..']])('a source of %s leaves the frame unmapped, never an empty source', async (_, source) => {
    expect((await first(source)).mapped).toBe(false)
  })

  test('a map over maxMapBytes, or with over four million segments or lines, is refused and reported', async () => {
    const reported = []
    const onError = (error) => reported.push(error.message)
    const real = fs.readFileSync(`${mapsDir('esbuild')}/${esbuildFile}.map`, 'utf8')
    const small = createResolver({ maps: { [esbuildFile]: real }, maxMapBytes: 1000, onError })
    expect((await small(realStack))[0].mapped).toBe(false)
    const lines = createResolver({ maps: { 'app.js': sourceMap('a.ts', { mappings: `${';'.repeat(4_000_001)}AAAA` }) }, onError })
    expect((await lines('    at f (https://h/app.js:1:1)'))[0].mapped).toBe(false)
    const long = createResolver({ maps: { 'app.js': sourceMap('a.ts', { mappings: 'A'.repeat(2000) }) }, maxMapBytes: 1000, onError })
    expect((await long('    at f (https://h/app.js:1:1)'))[0].mapped).toBe(false)
    expect(reported).toEqual([expect.stringMatching(/maxMapBytes/), expect.stringMatching(/four million/), expect.stringMatching(/maxMapBytes/)])
  })

  test('a map just under the limits is used', async () => {
    const ok = createResolver({ maps: { 'app.js': sourceMap('a.ts', { mappings: `${';'.repeat(1000)}AAAA` }) } })
    expect((await ok('    at f (https://h/app.js:1001:1)'))[0]).toMatchObject({ mapped: true, source: 'a.ts' })
  })
})

describe('maps that are small to store but expensive to open, and other leftovers', () => {
  const sourceMap = (extra) => ({ version: 3, sources: ['a.ts'], names: [], mappings: 'AAAA', ...extra })
  const frame = '    at f (https://h/app.js:1:1)'
  const refused = async (map, options = {}) => {
    const reported = []
    const frames = await createResolver({ maps: { 'app.js': map }, onError: (e) => reported.push(e.message), ...options })(frame)
    return { frames, reported }
  }

  test('a map of "A," repeated (millions of tiny segments) is refused', async () => {
    const { frames, reported } = await refused(sourceMap({ mappings: 'A,'.repeat(4_100_000) }))
    expect(frames[0].mapped).toBe(false)
    expect(reported[0]).toMatch(/four million segments/)
  })

  test('mappings given as arrays instead of text are refused', async () => {
    const { frames, reported } = await refused(sourceMap({ mappings: [[[0, 0, 0, 0]]] }))
    expect(frames[0].mapped).toBe(false)
    expect(reported).toHaveLength(1)
  })

  test.each([
    ['a source name of 5000 characters', sourceMap({ sources: ['a'.repeat(5000)] })],
    ['a sourceRoot of 5000 characters', sourceMap({ sourceRoot: 'a'.repeat(5000) })],
    ['300000 sources', sourceMap({ sources: Array(300000).fill('a.ts') })],
  ])('%s is refused', async (_, map) => {
    expect((await refused(map)).frames[0].mapped).toBe(false)
  })

  test('the message onError receives stays short even for a huge map with no mappings', async () => {
    const { reported } = await refused({ version: 3, sources: [], names: ['x'.repeat(5_000_000)] }, { maxMapBytes: 10_000_000 })
    expect(reported).toHaveLength(1)
    expect(reported[0].length).toBeLessThanOrEqual(500)
  })

  test('a map with mappings but no sources list is reported', async () => {
    const { frames, reported } = await refused({ version: 3, mappings: 'AAAA' })
    expect(frames[0].mapped).toBe(false)
    expect(reported).toHaveLength(1)
  })

  test('a map file much larger than maxMapBytes is refused before it is read, and so is a huge Buffer', async () => {
    const dir = fs.mkdtempSync(`${require('node:os').tmpdir()}/rbt-big-`)
    fs.writeFileSync(`${dir}/app.js.map`, 'x'.repeat(100))
    const reported = []
    const frames = await createResolver({ mapsDir: dir, maxMapBytes: 10, onError: (e) => reported.push(e.message) })(frame)
    expect(frames[0].mapped).toBe(false)
    expect(reported[0]).toMatch(/file is larger than maxMapBytes \(10\)/)
    const viaBuffer = await refused(Buffer.alloc(100, 'x'), { maxMapBytes: 10 })
    expect(viaBuffer.reported[0]).toMatch(/maxMapBytes/)
  })

  test.each([
    ['a line of zero', [[[0, 0, -1, 0]]]],
    ['a negative line', [[[0, 0, -5, -5]]]],
    ['a negative column', [[[0, 0, 0, -1]]]],
  ])('%s from a decoded map is not reported as a position', async (_, decoded) => {
    // the numbers are written as the VLQ text a real map would hold
    const vlq = (n) => { let v = n < 0 ? (-n << 1) | 1 : n << 1; let out = ''; do { let d = v & 31; v >>>= 5; if (v) d |= 32; out += 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'[d] } while (v); return out }
    const [[segment]] = decoded
    const { frames } = await refused(sourceMap({ mappings: segment.map(vlq).join('') }))
    expect(frames[0].line === null || frames[0].line >= 1).toBe(true)
    expect(frames[0].column === null || frames[0].column >= 1).toBe(true)
  })

  test('a source line far down a file (over 20000 lines) is not looked for', async () => {
    const content = `${'\n'.repeat(30000)}deep`
    const vlq = (n) => { let v = n << 1; let out = ''; do { let d = v & 31; v >>>= 5; if (v) d |= 32; out += 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'[d] } while (v); return out }
    const deep = createResolver({ maps: { 'app.js': sourceMap({ sourcesContent: [content], mappings: `AA${vlq(30000)}A` }) }, includeSource: true })
    const [first] = await deep(frame)
    expect(first).toMatchObject({ mapped: true, line: 30001, sourceLine: null })
  })

  test('a huge source file gets no source line, a tab becomes a space, and lone surrogates are removed', async () => {
    const make = (content) => createResolver({ maps: { 'app.js': sourceMap({ sourcesContent: [content] }) }, includeSource: true })(frame)
    expect((await make('x'.repeat(600000)))[0].sourceLine).toBeNull()
    expect((await make('return\tx'))[0].sourceLine).toBe('return x')
    expect((await make('a\ud800b'))[0].sourceLine).toBe('ab')
    const names = await createResolver({ maps: {} })(`    at a${'\u{1f600}'.repeat(150)} (u.js:1:1)`)
    expect(() => encodeURIComponent(names[0].name)).not.toThrow() // no half emoji left by the cut (isWellFormed needs Node 20)
  })

  test('names and sources that are only blanks are treated as missing', async () => {
    const blank = await createResolver({ maps: {} })('    at   (   :1:1)')
    expect(blank[0]).toMatchObject({ name: null, source: null })
    const mapped = await createResolver({ maps: { 'app.js': sourceMap({ sources: [' '] }) } })(frame)
    expect(mapped[0].mapped).toBe(false)
  })
})
