'use strict'

const createResolver = require('..')
const { formatStack } = createResolver
const { PROJECT_ROOT, mapsDir, bundle, readMap, recordedStacks } = require('./helpers')

const file = bundle('esbuild', 'app-')
const realMap = readMap('esbuild', file)
const stack = recordedStacks('chrome').variants.esbuild.emptyCheckout
const resolve = createResolver({ mapsDir: mapsDir('esbuild'), root: PROJECT_ROOT })

describe('a readable rebuilt stack', () => {
  test('frames.stack is the stack with original names, files and positions, ready for a log line', async () => {
    const frames = await resolve(stack)
    expect(frames.stack).toBe(
      [
        '    at validateCart (src/lib/cart.ts:9:11)',
        '    at checkout (src/lib/cart.ts:14:3)',
        '    at emptyCheckout (src/app.tsx:10:12)',
        '    at __run (http://localhost:43817/page:6:39)',
      ].join('\n')
    )
  })

  test('the stack text is not part of the data: JSON, Object.keys and equality see only the frames', async () => {
    const frames = await resolve(stack)
    expect(Object.keys(frames)).toEqual(['0', '1', '2', '3'])
    expect(JSON.parse(JSON.stringify(frames))).toHaveLength(4)
    expect(JSON.stringify(frames)).not.toContain('validateCart (')
    expect(frames).toEqual([...frames])
  })

  test('formatStack renders frames that were stored as JSON, and every shape of frame', () => {
    expect(
      formatStack([
        { source: 'src/a.ts', line: 3, column: 7, name: 'run' },
        { source: 'src/a.ts', line: 3, column: null, name: 'run' },
        { source: 'src/a.ts', line: null, column: null, name: null },
        { source: null, line: null, column: null, name: null },
        { source: '[native code]', line: null, column: null, name: 'map' },
      ])
    ).toBe(['    at run (src/a.ts:3:7)', '    at run (src/a.ts:3)', '    at src/a.ts', '    at <anonymous>', '    at map ([native code])'].join('\n'))
    expect(formatStack([])).toBe('')
  })

  test('an empty or unreadable stack gives an empty rebuilt stack', async () => {
    expect((await resolve('')).stack).toBe('')
    expect((await resolve(42)).stack).toBe('')
  })
})

describe('the original line of code (includeSource)', () => {
  const withSource = createResolver({ mapsDir: mapsDir('esbuild'), root: PROJECT_ROOT, includeSource: true })

  test('is off by default: no frame carries source text', async () => {
    const frames = await resolve(stack)
    expect(frames.every((f) => !('sourceLine' in f))).toBe(true)
  })

  test('when on, mapped frames carry the trimmed original line from sourcesContent; unmapped frames carry none', async () => {
    const frames = await withSource(stack)
    expect(frames.map((f) => f.sourceLine)).toEqual(["throw new Error('cart is empty')", 'validateCart(items)', 'return checkout([])', undefined])
  })

  test('a map without sourcesContent gives null, not a crash', async () => {
    const { sourcesContent, ...bare } = realMap
    const frames = await createResolver({ maps: { [file]: bare }, includeSource: true })(stack)
    expect(frames.slice(0, 3).map((f) => f.sourceLine)).toEqual([null, null, null])
  })

  test('a map whose sourcesContent is shorter than the position gives null', async () => {
    const short = { ...realMap, sourcesContent: realMap.sourcesContent.map(() => 'one line only') }
    const frames = await createResolver({ maps: { [file]: short }, includeSource: true })(stack)
    expect(frames.slice(0, 3).map((f) => f.sourceLine)).toEqual([null, null, null])
  })

  test('Windows line endings are not part of the line, and a huge line is cut to 300 characters', async () => {
    const crlf = { ...realMap, sourcesContent: realMap.sourcesContent.map((text) => text.replace(/\n/g, '\r\n')) }
    const frames = await createResolver({ maps: { [file]: crlf }, includeSource: true })(stack)
    expect(frames[0].sourceLine).toBe("throw new Error('cart is empty')")
    const minified = { ...realMap, sourcesContent: realMap.sourcesContent.map(() => `${'\n'.repeat(8)}${'x'.repeat(1000)}`) }
    const [first] = await createResolver({ maps: { [file]: minified }, includeSource: true })(stack)
    expect(first.sourceLine).toBe('x'.repeat(300))
  })
})

describe('setting the resolver up', () => {
  test('the package exports createResolver, setup (the 0.x name) and formatStack', () => {
    expect(createResolver.createResolver).toBe(createResolver)
    expect(createResolver.setup).toBe(createResolver)
    expect(typeof createResolver.formatStack).toBe('function')
  })

  test.each([
    ['no arguments', []],
    ['a number', [42]],
    ['null', [null]],
    ['an empty object (nothing says where the maps are)', [{}]],
    ['mapsDir that is not a string', [{ mapsDir: 5 }]],
    ['maps that is a string', [{ maps: 'x' }]],
    ['maps that is null', [{ maps: null }]],
    ['loadMap that is not a function', [{ loadMap: 'x' }]],
    ['onError that is not a function', [{ maps: {}, onError: 1 }]],
    ['maxFrames of zero', [{ maps: {}, maxFrames: 0 }]],
    ['maxFrames of 1.5', [{ maps: {}, maxFrames: 1.5 }]],
    ['maxStackLength as text', [{ maps: {}, maxStackLength: '1000' }]],
    ['maxCachedMaps below one', [{ maps: {}, maxCachedMaps: -1 }]],
  ])('%s is a TypeError at setup, not a surprise later', (_, args) => {
    expect(() => createResolver(...args)).toThrow(TypeError)
    expect(() => createResolver(...args)).toThrow(/resolve-browser-trace/)
  })

  test('each of mapsDir, maps and loadMap alone is enough', () => {
    expect(() => createResolver({ mapsDir: '/nowhere' })).not.toThrow()
    expect(() => createResolver({ maps: {} })).not.toThrow()
    expect(() => createResolver({ loadMap: () => null })).not.toThrow()
  })
})
