'use strict'

const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const createResolver = require('..')
const { PROJECT_ROOT, mapsDir, bundle, readMap, recordedStacks } = require('./helpers')

// "Where does the server keep its source maps?" Production never serves .map files, so the server must be able to
// find them in a private folder, in memory (a `bun build --compile` binary has no folder), or from anywhere via a callback.

const chrome = recordedStacks('chrome')
const esbuildFile = bundle('esbuild', 'app-')
const esbuildStack = chrome.variants.esbuild.emptyCheckout
const esbuildMapText = fs.readFileSync(path.join(mapsDir('esbuild'), `${esbuildFile}.map`), 'utf8')
const firstFrame = async (resolve) => (await resolve(esbuildStack))[0]
const MAPPED = { source: 'src/lib/cart.ts', line: 9, name: 'validateCart', mapped: true }

function tmpFolder() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'rbt-maps-'))
}

describe('maps in a private folder', () => {
  test('the 0.x call, setup(folder), keeps working and still resolves a stack', async () => {
    const resolve = createResolver(mapsDir('esbuild'))
    expect(await firstFrame(resolve)).toMatchObject({ source: 'src/lib/cart.ts', line: 9, mapped: true })
  })

  test('{ mapsDir } finds "<bundle file name>.map" for the script the browser ran', async () => {
    const resolve = createResolver({ mapsDir: mapsDir('esbuild'), root: PROJECT_ROOT })
    expect(await firstFrame(resolve)).toMatchObject(MAPPED)
  })

  test('a folder that does not exist (a deploy that forgot the maps) gives unmapped frames, not a crash', async () => {
    const resolve = createResolver({ mapsDir: path.join(os.tmpdir(), 'rbt-no-such-folder') })
    const frames = await resolve(esbuildStack)
    expect(frames.length).toBeGreaterThan(0)
    expect(frames.every((frame) => frame.mapped === false)).toBe(true)
    expect(frames[0]).toMatchObject({ source: `http://localhost:43817/esbuild/${esbuildFile}`, line: 1, column: 301 })
  })

  test('a "folder" that is really a file gives unmapped frames too', async () => {
    const resolve = createResolver({ mapsDir: path.join(mapsDir('esbuild'), esbuildFile) })
    expect((await firstFrame(resolve)).mapped).toBe(false)
  })

  test('a map copied into the folder after the server started is found on the next error', async () => {
    const folder = tmpFolder()
    const resolve = createResolver({ mapsDir: folder })
    expect((await firstFrame(resolve)).mapped).toBe(false)
    fs.writeFileSync(path.join(folder, `${esbuildFile}.map`), esbuildMapText)
    expect((await firstFrame(resolve)).mapped).toBe(true)
  })

  test('the map is matched by the exact bundle name, never by a name that merely contains it', async () => {
    const folder = tmpFolder()
    const hash = esbuildFile.replace(/\.js$/, '')
    // a decoy from another site that sorts first and contains the same text; its mappings point at other files
    const decoy = { ...JSON.parse(esbuildMapText), sources: ['decoy/not-the-right-file.ts'] }
    fs.writeFileSync(path.join(folder, `a-${hash}.js.map`), JSON.stringify(decoy))
    fs.writeFileSync(path.join(folder, `${hash}.js.map`), esbuildMapText)
    fs.writeFileSync(path.join(folder, `${hash}.map.js`), 'throw new Error("not a map")')
    const resolve = createResolver({ mapsDir: folder })
    expect(await firstFrame(resolve)).toMatchObject({ source: 'src/lib/cart.ts' })
    const alone = tmpFolder()
    fs.writeFileSync(path.join(alone, `a-${hash}.js.map`), JSON.stringify(decoy))
    expect((await firstFrame(createResolver({ mapsDir: alone }))).mapped).toBe(false)
  })
})

describe('maps in memory', () => {
  test.each([
    ['JSON text', esbuildMapText],
    ['a Buffer, as fs.readFileSync returns it', Buffer.from(esbuildMapText)],
    ['a parsed object', JSON.parse(esbuildMapText)],
  ])('{ maps } keyed by bundle file name accepts %s (no folder needed, e.g. in a bun --compile binary)', async (_, map) => {
    const resolve = createResolver({ maps: { [esbuildFile]: map }, root: PROJECT_ROOT })
    expect(await firstFrame(resolve)).toMatchObject(MAPPED)
  })

  test('a name that is not a key does not find another bundle\'s map', async () => {
    const resolve = createResolver({ maps: { 'other-1234.js': esbuildMapText } })
    expect((await firstFrame(resolve)).mapped).toBe(false)
  })

  test('stack text cannot reach into the prototype of the maps object', async () => {
    const resolve = createResolver({ maps: {} })
    const frames = await resolve('    at x (https://h/constructor:1:1)\n    at y (https://h/__proto__:1:1)\n    at z (https://h/toString:1:1)')
    expect(frames.map((f) => f.mapped)).toEqual([false, false, false])
  })

  test('maps of many bundles can sit side by side', async () => {
    const maps = {}
    for (const variant of ['bun', 'esbuild', 'esbuild-split']) {
      for (const name of fs.readdirSync(mapsDir(variant)).filter((f) => f.endsWith('.map'))) {
        maps[name.replace(/\.map$/, '')] = fs.readFileSync(path.join(mapsDir(variant), name), 'utf8')
      }
    }
    const resolve = createResolver({ maps })
    const frames = await resolve(`${recordedStacks('chrome').variants.bun.emptyCheckout}\n${esbuildStack}`)
    expect(frames.filter((f) => f.mapped).length).toBe(6)
  })
})

describe('maps from a callback', () => {
  test('loadMap(fileName) is asked for the bundle name and its map is used (sync or async)', async () => {
    const asked = []
    const resolve = createResolver({
      loadMap: async (name) => {
        asked.push(name)
        return name === esbuildFile ? esbuildMapText : null
      },
    })
    expect(await firstFrame(resolve)).toMatchObject({ source: 'src/lib/cart.ts', mapped: true })
    expect(asked).toEqual([esbuildFile])
    const sync = createResolver({ loadMap: (name) => (name === esbuildFile ? JSON.parse(esbuildMapText) : undefined) })
    expect((await firstFrame(sync)).mapped).toBe(true)
  })

  test('when several sources are set the order is maps, then loadMap, then mapsDir', async () => {
    const calls = []
    const resolve = createResolver({
      maps: { [esbuildFile]: esbuildMapText },
      loadMap: (name) => calls.push(name) && null,
      mapsDir: mapsDir('esbuild'),
    })
    expect((await firstFrame(resolve)).mapped).toBe(true)
    expect(calls).toEqual([])
    const fallback = createResolver({ maps: {}, loadMap: (name) => calls.push(name) && null, mapsDir: mapsDir('esbuild') })
    expect((await firstFrame(fallback)).mapped).toBe(true)
    expect(calls).toEqual([esbuildFile])
  })

  test('a loadMap that throws or rejects costs the frames their mapping, not the request, and is reported', async () => {
    const reported = []
    const onError = (error, info) => reported.push([error.message, info.file])
    for (const loadMap of [
      () => {
        throw new Error('db down')
      },
      () => Promise.reject(new Error('db down')),
    ]) {
      const frames = await createResolver({ loadMap, onError })(esbuildStack)
      expect(frames.length).toBeGreaterThan(0)
      expect(frames.every((f) => f.mapped === false)).toBe(true)
    }
    expect(reported).toEqual([['db down', esbuildFile], ['db down', esbuildFile]])
  })
})

describe('maps that are broken', () => {
  test.each([
    ['not JSON', 'this is not json'],
    ['a JSON number', '42'],
    ['a function', () => {}],
    ['a number', 42],
    ['a map with no mappings or sources', '{"version":3}'],
    ['a map whose mappings are not text', JSON.stringify({ version: 3, sources: ['a.ts'], names: [], mappings: 5 })],
    ['an index map (sections), which is not supported', JSON.stringify({ version: 3, sections: [] })],
  ])('%s: the frames come back unmapped and the problem goes to onError', async (_, broken) => {
    const reported = []
    const resolve = createResolver({ maps: { [esbuildFile]: broken }, onError: (error, info) => reported.push(info.file) })
    const frames = await resolve(esbuildStack)
    expect(frames[0]).toMatchObject({ mapped: false, line: 1, column: 301 })
    expect(reported).toEqual([esbuildFile])
  })

  test('a map file that cannot be read (it is a directory) is reported, and a throwing onError changes nothing', async () => {
    const folder = tmpFolder()
    fs.mkdirSync(path.join(folder, `${esbuildFile}.map`))
    const reported = []
    const resolve = createResolver({ mapsDir: folder, onError: (error) => reported.push(error.code) })
    expect((await firstFrame(resolve)).mapped).toBe(false)
    expect(reported).toEqual(['EISDIR'])
    const silent = createResolver({
      mapsDir: folder,
      onError: () => {
        throw new Error('logger is broken')
      },
    })
    expect((await firstFrame(silent)).mapped).toBe(false)
  })

  test('without onError a broken map is just unmapped frames', async () => {
    const resolve = createResolver({ maps: { [esbuildFile]: 'nope' } })
    expect((await firstFrame(resolve)).mapped).toBe(false)
  })
})

describe('how long maps are kept', () => {
  const counting = (extra = {}) => {
    const loads = []
    const resolve = createResolver({
      loadMap: (name) => {
        loads.push(name)
        return name.startsWith('real-') ? esbuildMapText : null
      },
      ...extra,
    })
    return { resolve, loads }
  }
  const stackFor = (name) => `    at f (https://shop.example.com/${name}:1:301)`

  test('a real map is loaded once and then served from memory', async () => {
    const { resolve, loads } = counting()
    await resolve(stackFor('real-1.js'))
    await resolve(stackFor('real-1.js'))
    await resolve(stackFor('real-1.js'))
    expect(loads).toEqual(['real-1.js'])
  })

  test('requests that arrive together for one bundle share a single load', async () => {
    const { resolve, loads } = counting()
    await Promise.all(Array.from({ length: 50 }, () => resolve(stackFor('real-1.js'))))
    expect(loads).toEqual(['real-1.js'])
  })

  test('only maxCachedMaps real maps are kept: the least recently used one is dropped first', async () => {
    const { resolve, loads } = counting({ maxCachedMaps: 2 })
    await resolve(stackFor('real-1.js'))
    await resolve(stackFor('real-2.js'))
    await resolve(stackFor('real-1.js')) // 1 is now the most recent
    await resolve(stackFor('real-3.js')) // pushes out 2
    await resolve(stackFor('real-1.js')) // still cached
    await resolve(stackFor('real-2.js')) // was dropped: loaded again
    expect(loads).toEqual(['real-1.js', 'real-2.js', 'real-3.js', 'real-2.js'])
  })

  test('thousands of fake bundle names from a hostile page are never kept', async () => {
    const { resolve, loads } = counting({ maxCachedMaps: 2 })
    await resolve(stackFor('real-1.js'))
    for (let i = 0; i < 3000; i++) {
      await resolve(stackFor(`fake-${i}.js`))
    }
    await resolve(stackFor('real-1.js'))
    expect(loads.filter((name) => name === 'real-1.js')).toHaveLength(1) // the real map was not pushed out by the fakes
    await resolve(stackFor('fake-0.js'))
    expect(loads.filter((name) => name === 'fake-0.js')).toHaveLength(2) // a fake is asked for again: it was not cached
  })

  test('one stack opens at most maxMapsPerStack maps (4 unless set), however many bundles and frames it has', async () => {
    const { resolve, loads } = counting()
    const stack = Array.from({ length: 500 }, (_, i) => stackFor(`fake-${i}.js`)).join('\n')
    await resolve(stack)
    expect(loads).toHaveLength(4)
    const wider = counting({ maxMapsPerStack: 7 })
    await wider.resolve(stack)
    expect(wider.loads).toHaveLength(7)
  })
})

describe('bundle names from different bundlers, with query strings and fragments', () => {
  const map = JSON.parse(esbuildMapText)
  const frame = (url) => `    at w (${url}:1:301)`

  test.each([
    ['bun content hash', 'app-pf2qqq1g.js'],
    ['bun chunk', 'chunk-8d7s6a5f.js'],
    ['webpack contenthash', 'main.5f3e9c1a2b.chunk.js'],
    ['webpack runtime', 'runtime~main.0a1b2c3d.js'],
    ['vite / rollup hash', 'index-BzS2xa1Q.js'],
    ['esbuild hash', 'app-CQH66RKJ.js'],
    ['a scoped-looking name', 'vendor@2.1.0+build~3.js'],
  ])('%s (%s) is found by its exact file name', async (_, name) => {
    const resolve = createResolver({ maps: { [name]: map } })
    expect((await resolve(frame(`https://cdn.example.com/assets/${name}`)))[0].mapped).toBe(true)
  })

  test.each([
    ['a query string', '?v=20261014'],
    ['a fragment', '#section'],
    ['both', '?v=1&token=secret#x'],
  ])('%s after the file name does not change which map is used, and is not echoed back for unmapped frames', async (_, suffix) => {
    const resolve = createResolver({ maps: { 'app-1.js': map } })
    expect((await resolve(frame(`https://h/app-1.js${suffix}`)))[0].mapped).toBe(true)
    const unmapped = await createResolver({ maps: {} })(frame(`https://h/app-1.js${suffix}`))
    expect(unmapped[0].source).toBe('https://h/app-1.js')
  })

  test('a file:// URL, a path-only URL and a bare name all resolve by their last segment', async () => {
    const resolve = createResolver({ maps: { 'app-1.js': map } })
    for (const where of ['file:///srv/www/app-1.js', '/static/app-1.js', 'app-1.js']) {
      expect((await resolve(frame(where)))[0].mapped).toBe(true)
    }
  })
})

describe('bundle names that try to escape the maps folder', () => {
  const secretFolder = tmpFolder()
  const mapsFolder = path.join(secretFolder, 'maps')
  fs.mkdirSync(mapsFolder)
  fs.writeFileSync(path.join(secretFolder, 'secret.js.map'), esbuildMapText)
  fs.writeFileSync(path.join(secretFolder, 'secret.map'), esbuildMapText)
  fs.writeFileSync(path.join(mapsFolder, 'app.js.map'), esbuildMapText)

  test.each([
    ['dot-dot segments in the URL', 'https://h/../secret.js'],
    ['an encoded slash', 'https://h/..%2fsecret.js'],
    ['backslashes', 'https://h/..\\secret.js'],
    ['a bare backslash path', '..\\..\\secret.js'],
    ['a null byte', 'https://h/secret.js%00.js'],
    ['a literal null byte', 'https://h/secret\u0000.js'],
    ['a name that is only dots', 'https://h/..'],
    ['a map file name as the bundle name', 'https://h/../../etc/passwd.map'],
    ['an absolute path', '/etc/passwd'],
    ['a very long name', `https://h/${'a'.repeat(300)}.js`],
    ['an empty name', 'https://h/'],
  ])('%s never reads a file outside the folder', async (_, url) => {
    const asked = []
    const resolve = createResolver({ mapsDir: mapsFolder, loadMap: (name) => asked.push(name) && null })
    const frames = await resolve(`    at f (${url}:1:301)`)
    expect(frames[0].mapped).toBe(false)
    for (const name of asked) {
      expect(name).toMatch(/^[\w.@+~=,-]+$/)
    }
  })

  test('the plain-name case beside them does map, so the cases above are not passing by accident', async () => {
    const resolve = createResolver({ mapsDir: mapsFolder })
    expect((await resolve('    at f (https://h/app.js:1:301)'))[0].mapped).toBe(true)
  })

  test('a name with a dot-dot inside is passed to loadMap only if it is a plain file name', async () => {
    const asked = []
    const resolve = createResolver({ loadMap: (name) => asked.push(name) && null })
    await resolve('    at f (https://h/a..b.js:1:301)')
    expect(asked).toEqual(['a..b.js'])
  })
})
