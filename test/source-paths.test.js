'use strict'

const createResolver = require('..')
const { bundle, readMap, recordedStacks, withSources } = require('./helpers')

// "The log must never tell the world how the build machine is laid out." Source maps record file names in many
// styles. The server returns short project paths, and never an absolute path of the machine that ran the bundler.
//
// The maps below are copies of the real esbuild map with the `sources` entries rewritten into the styles other
// bundlers use (webpack://, file://, absolute paths, Vite's /@fs/, Windows paths); the mappings are untouched.

const file = bundle('esbuild', 'app-')
const realMap = readMap('esbuild', file)
const chrome = recordedStacks('chrome').variants.esbuild.emptyCheckout
// realMap.sources: [lazy.ts, cart.ts, pricing.ts, view.tsx, app.tsx], relative to the output folder ("../../src/lib/cart.ts").
// The stack resolves to cart.ts twice and app.tsx once.
const replacing = ({ cart, app }) => realMap.sources.map((s, i) => (i === 1 ? cart : i === 4 ? app : s))
const sourcesOf = async (sources, options = {}) => {
  const map = { ...realMap, sources }
  const frames = await createResolver({ maps: { [file]: map }, ...options })(chrome)
  return frames.filter((f) => f.mapped).map((f) => f.source)
}
const spelled = (prefix) => withSources(realMap, (s) => s.replace('../../', prefix)).sources

describe('paths relative to the bundler output folder', () => {
  test('are returned as project paths (../../src/lib/cart.ts -> src/lib/cart.ts)', async () => {
    expect(await sourcesOf(realMap.sources)).toEqual(['src/lib/cart.ts', 'src/lib/cart.ts', 'src/app.tsx'])
  })
})

describe('webpack style names', () => {
  test('webpack:///./src/... loses its prefix', async () => {
    expect(await sourcesOf(spelled('webpack:///./'))).toEqual(['src/lib/cart.ts', 'src/lib/cart.ts', 'src/app.tsx'])
  })

  test('webpack://<project name>/./src/...?<hash> loses prefix and query', async () => {
    expect(await sourcesOf(spelled('webpack://shop-web/./').map((s) => `${s}?1a2b`))).toEqual(['src/lib/cart.ts', 'src/lib/cart.ts', 'src/app.tsx'])
  })

  test('webpack\'s own files keep their names', async () => {
    const sources = realMap.sources.map(() => 'webpack:///webpack/bootstrap')
    expect(await sourcesOf(sources)).toEqual(['webpack/bootstrap', 'webpack/bootstrap', 'webpack/bootstrap'])
  })

  test('code from node_modules keeps node_modules/<package>/... even from a deep build path', async () => {
    const sources = realMap.sources.map(() => 'webpack:///../../../ci/work/shop/node_modules/react-dom/cjs/react-dom.production.js')
    expect(await sourcesOf(sources)).toEqual(Array(3).fill('node_modules/react-dom/cjs/react-dom.production.js'))
  })
})

describe('absolute paths of the build machine', () => {
  const absolute = (root) => withSources(realMap, (s) => s.replace('../../', `${root}/`)).sources

  test('with root set, paths under it become relative to it', async () => {
    expect(await sourcesOf(absolute('/srv/ci/build/shop'), { root: '/srv/ci/build/shop' })).toEqual(['src/lib/cart.ts', 'src/lib/cart.ts', 'src/app.tsx'])
  })

  test('a trailing slash, or backslashes, in root do not matter', async () => {
    expect(await sourcesOf(absolute('/srv/ci/build/shop'), { root: '/srv/ci/build/shop/' })).toEqual(['src/lib/cart.ts', 'src/lib/cart.ts', 'src/app.tsx'])
    expect(await sourcesOf(absolute('C:/build/shop'), { root: 'C:\\build\\shop' })).toEqual(['src/lib/cart.ts', 'src/lib/cart.ts', 'src/app.tsx'])
  })

  test('with root set, a sibling folder that merely starts with the same name is not "under" it', async () => {
    const out = await sourcesOf(absolute('/srv/ci/build/shop-admin/packages/ui'), { root: '/srv/ci/build/shop' })
    expect(out).toEqual(['src/lib/cart.ts', 'src/lib/cart.ts', 'src/app.tsx'])
    expect(out.join()).not.toContain('shop-admin')
  })

  test('with root set, a file elsewhere is cut to src/... or its last two segments', async () => {
    const out = await sourcesOf(replacing({ cart: '/opt/other/tool/src/a.ts', app: '/opt/other/b.ts' }), { root: '/srv/ci/build/shop' })
    expect(out).toEqual(['src/a.ts', 'src/a.ts', 'other/b.ts'])
  })

  test('without root, an absolute path is cut to src/... from its last src folder', async () => {
    expect(await sourcesOf(absolute('/Users/ci/build/shop'))).toEqual(['src/lib/cart.ts', 'src/lib/cart.ts', 'src/app.tsx'])
  })

  test('without root and without a src folder, only the last two segments are kept', async () => {
    expect(await sourcesOf(replacing({ cart: '/Users/ci/build/shop/lib/cart.ts', app: '/Users/ci/build/shop/app.tsx' }))).toEqual(['lib/cart.ts', 'lib/cart.ts', 'shop/app.tsx'])
  })

  test('a src folder as the very last segment is not treated as a project path', async () => {
    expect(await sourcesOf(Array(5).fill('/Users/ci/build/src'))).toEqual(Array(3).fill('build/src'))
  })

  test('Windows paths with dot-dot segments are collapsed too', async () => {
    expect(await sourcesOf(replacing({ cart: 'src\\lib\\..\\lib\\cart.ts', app: 'src\\app.tsx' }))).toEqual(['src/lib/cart.ts', 'src/lib/cart.ts', 'src/app.tsx'])
  })

  test('file:// URLs, Windows drive paths and Vite\'s /@fs/ prefix are all handled', async () => {
    const expected = ['src/lib/cart.ts', 'src/lib/cart.ts', 'src/app.tsx']
    expect(await sourcesOf(absolute('file:///Users/ci/build/shop'))).toEqual(expected)
    expect(await sourcesOf(absolute('C:\\Users\\ci\\build\\shop').map((s) => s.replace(/\//g, '\\')))).toEqual(expected)
    expect(await sourcesOf(absolute('/@fs/Users/ci/build/shop'))).toEqual(expected)
    expect(await sourcesOf(absolute('file:///C:/build/shop'))).toEqual(expected)
  })
})

describe('whatever the map says, no result is an absolute or climbing path', () => {
  test.each([
    ['../../../../../etc/passwd'],
    ['/etc/passwd'],
    ['C:\\Windows\\System32\\config\\SAM'],
    ['file:///etc/shadow'],
    ['webpack:///../../../../etc/hosts'],
    ['..'],
    ['/'],
    [''],
    ['././.'],
    ['\\\\server\\share\\secret\\a.ts'],
    ['////a/b/c.ts'],
    ['a/../../../b/c.ts'],
    ['/Users/ci/../../../root/.ssh/id_rsa'],
    ['src\\a\\..\\..\\..\\b.ts'],
    ['vm:///Users/ci/x.ts'],
    ['c:foo.ts'],
    ['./C:/Users/x.ts'],
    ['file:/Users/ci/secret/x.ts'],
    ['/x/c:/y.ts'],
    ['/x/y/C:'],
  ])('source %j', async (hostile) => {
    const out = await sourcesOf(Array(5).fill(hostile))
    expect(out.length).toBeLessThanOrEqual(3)
    for (const source of out) {
      expect(source).not.toMatch(/^([/\\]|[A-Za-z]:|\.\.)/)
      expect(source).not.toContain('..')
    }
  })

  test('a map whose mappings point at a sources entry that does not exist leaves those frames unmapped', async () => {
    const frames = await createResolver({ maps: { [file]: { ...realMap, sources: [] } } })(chrome)
    expect(frames.slice(0, 3).map((f) => f.mapped)).toEqual([false, false, false])
  })

  test('a map whose source names nothing at all leaves the frame unmapped, with its own script URL', async () => {
    const frames = await createResolver({ maps: { [file]: { ...realMap, sources: Array(5).fill('..') } } })(chrome)
    expect(frames[0]).toMatchObject({ mapped: false, line: 1, column: 301 })
  })
})
