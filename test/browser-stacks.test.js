'use strict'

const createResolver = require('..')
const { PROJECT_ROOT, mapsDir, recordedStacks } = require('./helpers')

// Every stack below is a real `error.stack`, recorded by scripts/capture-stacks.js from the browser or runtime
// named in the story, running the minified bundles in test/fixtures/dist. The bundles come from
// `bun build --minify --sourcemap=external` and from esbuild, with and without code splitting.
// The source files are test/fixtures/src: a small TSX shop (cart, pricing, a JSX view, a lazily loaded chunk).

const SCENARIOS = {
  emptyCheckout: ['src/lib/cart.ts:9', 'src/lib/cart.ts:14', 'src/app.tsx:10'],
  quoteNegative: ['src/lib/pricing.ts:10', 'src/app.tsx:13'],
  bigDiscount: ['src/lib/pricing.ts:18', 'src/app.tsx:16'],
  blankRow: ['src/view.tsx:10', 'src/view.tsx:16', 'src/view.tsx:16', 'src/app.tsx:19'],
  rejectLater: ['src/lib/cart.ts:9', 'src/lib/cart.ts:14', 'src/app.tsx:24'],
  lazyFailure: ['src/lib/lazy.ts:2', 'src/app.tsx:28'],
}

const where = (frames) => frames.filter((frame) => frame.mapped).map((frame) => `${frame.source}:${frame.line}`)

// Chrome, Edge and Firefox report every frame. Safari's engine drops frames of functions that ended in a tail call,
// Node loses the async frames of an awaited call, so for those the recorded chain is the start of the full one.
const COMPLETE = new Set(['chrome', 'edge', 'firefox'])

describe.each(['chrome', 'edge', 'firefox', 'webkit', 'node', 'bun'])('a server resolves the stacks recorded from %s', (browser) => {
  const recorded = recordedStacks(browser)

  describe.each(Object.keys(recorded.variants))('from the %s bundle', (variant) => {
    const resolve = createResolver({ mapsDir: mapsDir(variant), root: PROJECT_ROOT })

    test.each(Object.keys(SCENARIOS))('%s: gives back the TSX files and lines that were running', async (scenario) => {
      const frames = await resolve(recorded.variants[variant][scenario])
      const chain = where(frames)
      const expected = SCENARIOS[scenario]
      if (COMPLETE.has(browser)) {
        expect(chain).toEqual(expected)
      } else {
        expect(chain.length).toBeGreaterThanOrEqual(1)
        expect(chain).toEqual(expected.slice(0, chain.length))
      }
      for (const frame of frames.filter((f) => f.mapped)) {
        expect(frame.source).toMatch(/^src\/.+\.tsx?$/)
      }
    })
  })
})

describe('a server resolves function names, columns and unmapped frames', () => {
  test('esbuild maps carry names: the original function names come back, not the minified ones (Chrome)', async () => {
    const resolve = createResolver({ mapsDir: mapsDir('esbuild'), root: PROJECT_ROOT })
    const frames = await resolve(recordedStacks('chrome').variants.esbuild.emptyCheckout)
    expect(frames.slice(0, 3).map((f) => f.name)).toEqual(['validateCart', 'checkout', 'emptyCheckout'])
    expect(frames.slice(0, 3).map((f) => [f.source, f.line, f.column])).toEqual([
      ['src/lib/cart.ts', 9, 11],
      ['src/lib/cart.ts', 14, 3],
      ['src/app.tsx', 10, 12],
    ])
  })

  test('the same names come back from Firefox, and an anonymous callback inside a component has none', async () => {
    const resolve = createResolver({ mapsDir: mapsDir('esbuild'), root: PROJECT_ROOT })
    const frames = await resolve(recordedStacks('firefox').variants.esbuild.blankRow)
    expect(frames.slice(0, 4).map((f) => f.name)).toEqual(['Row', null, 'CartView', 'blankRow'])
  })

  test('bun maps have no names, so a frame keeps the name the browser printed, but file, line and column are exact', async () => {
    const resolve = createResolver({ mapsDir: mapsDir('bun'), root: PROJECT_ROOT })
    const frames = await resolve(recordedStacks('chrome').variants.bun.quoteNegative)
    expect(frames[0]).toEqual({ source: 'src/lib/pricing.ts', line: 10, column: 17, name: 'quote', arguments: [], mapped: true })
    expect(frames[1]).toMatchObject({ source: 'src/app.tsx', line: 13, column: 37, name: 'quoteNegative', mapped: true })
  })

  test('a frame outside the bundles (the page itself, a native function) comes back unmapped with its own location', async () => {
    const resolve = createResolver({ mapsDir: mapsDir('esbuild'), root: PROJECT_ROOT })
    const frames = await resolve(recordedStacks('chrome').variants.esbuild.blankRow)
    expect(frames[2]).toEqual({ source: '<anonymous>', line: null, column: null, name: 'map', arguments: [], mapped: false })
    expect(frames[5]).toEqual({ source: 'http://localhost:43817/page', line: 6, column: 39, name: '__run', arguments: [], mapped: false })
  })

  test('a position that no mapping covers (the bundler runtime helpers at the top of the file) stays unmapped', async () => {
    const resolve = createResolver({ mapsDir: mapsDir('bun'), root: PROJECT_ROOT })
    const frames = await resolve('    at helper (https://shop.example.com/assets/app-pf2qqq1g.js:1:3)')
    expect(frames).toEqual([{ source: 'https://shop.example.com/assets/app-pf2qqq1g.js', line: 1, column: 3, name: 'helper', arguments: [], mapped: false }])
  })

  test('the bun runtime and node, running the minified bundle, give stacks that resolve too', async () => {
    const resolve = createResolver({ mapsDir: mapsDir('bun'), root: PROJECT_ROOT })
    for (const runtime of ['bun', 'node']) {
      const frames = await resolve(recordedStacks(runtime).variants.bun.blankRow)
      expect(where(frames)).toEqual(SCENARIOS.blankRow)
    }
  })
})
