# resolve-browser-trace

[![npm version](https://img.shields.io/npm/v/resolve-browser-trace.svg)](https://www.npmjs.com/package/resolve-browser-trace)
[![license](https://img.shields.io/npm/l/resolve-browser-trace.svg)](LICENSE)
[![node](https://img.shields.io/node/v/resolve-browser-trace.svg)](package.json)

### When it comes to the stability of your web application, knowing when your **production users have a problem is critical**!

Locally you get readable stack traces. In production your code is minified, and you do not want to publish
`.map` files that hand the world your source.

**Send the client error and its stack to your server. Let the server rebuild the stack from source maps it keeps
private, then log that.**

`resolve-browser-trace` is that last step: it takes the text of `error.stack` from any browser and gives back the
original file, line, column and function name of every frame.

```js
const createResolver = require('resolve-browser-trace')
const resolve = createResolver({ mapsDir: '/srv/private/maps', root: '/srv/build/shop' })

const frames = await resolve(`TypeError: x is not a function
    at w (https://shop.example.com/assets/app-CQH66RKJ.js:1:301)
    at o (https://shop.example.com/assets/app-CQH66RKJ.js:1:349)
    at Object.emptyCheckout (https://shop.example.com/assets/app-CQH66RKJ.js:1:894)`)

console.log(frames.stack)
//     at validateCart (src/lib/cart.ts:9:11)
//     at checkout (src/lib/cart.ts:14:3)
//     at emptyCheckout (src/app.tsx:10:12)
```

* Chrome, Edge, Firefox, Safari, Node and Bun stack formats
* Source maps from a folder, from memory (a `bun build --compile` binary has no folder) or from your own callback
* Safe with hostile input: it never throws, never rejects, never reads outside your maps folder, never lets a page
  grow its memory, and never returns an absolute path of your build machine
* One small dependency ([`@jridgewell/trace-mapping`](https://github.com/jridgewell/trace-mapping), pure JavaScript,
  no WebAssembly), TypeScript types, CommonJS and ES module entries

## Install

```sh
npm install resolve-browser-trace      # or: bun add resolve-browser-trace
```

Node 18 or later, or Bun.

## API

```js
const createResolver = require('resolve-browser-trace')   // CommonJS
import createResolver, { formatStack } from 'resolve-browser-trace'   // ESM
```

### `createResolver(options)` returns `resolve(stack)`

`createResolver('/srv/private/maps')` is the same as `createResolver({ mapsDir: '/srv/private/maps' })`, and is the
call 0.x versions used (`setup` is kept as another name for `createResolver`).

| Option | Default | |
|---|---|---|
| `mapsDir` | | A folder with `<bundle file name>.map` files, for example `app-1a2b3c.js.map`. A map is read the first time its bundle shows up, so maps copied there after the server started are found. Once loaded it stays cached until evicted: use new file names (content hashes do) to replace a map. |
| `maps` | | Maps in memory, keyed by bundle file name: `{ 'app-1a2b3c.js': jsonTextBufferOrObject }`. Parsed when first needed, then cached. |
| `loadMap` | | `(fileName) => map \| null \| Promise<map \| null>`. Called with the bundle file name; return its map or `null`. The name comes from the client, so treat it as untrusted. Misses are not cached and there is no timeout, and one stack can call it up to `maxMapsPerStack` times: cache misses and bound the time yourself if it reaches a database or the network. |
| `root` | | The folder your bundler ran in, for example `/srv/build/shop`. Source paths under it come back relative to it. |
| `includeSource` | `false` | Add `sourceLine`, the original line of code from the map's `sourcesContent`. Off by default because it puts source code in your logs. It is `null` when the file is over 500,000 characters or the line is past 20,000. |
| `onError` | | `(error, { file })`, called when a map exists but cannot be loaded or parsed. A map that does not exist is not an error. |
| `maxStackLength` | `65536` | Characters of stack text read; the rest is ignored. |
| `maxFrames` | `100` | Frames returned for one stack. |
| `maxCachedMaps` | `16` | Parsed maps kept in memory, least recently used out first. Keep it above the number of bundles that are live at once (older releases' maps count too), or maps are re-read and re-parsed all the time. |
| `maxMapBytes` | `33554432` | Largest map accepted, in characters of JSON. Bigger maps, maps whose `mappings` hold over four million `,`/`;` separators, and maps whose `mappings` are not text are reported to `onError` and not used. The separator count does not bound memory by itself: a parsed map costs roughly 14 to 40 bytes of heap per character of `mappings`, so budget `maxMapBytes` times `maxCachedMaps` for the worst case (a 32 MiB pathological map held about 600 MB). |
| `maxMapsPerStack` | `4` | Most maps opened for one stack; frames of further bundles stay unmapped. Parsing a map is synchronous work, so this bounds what one request can cost. |

At least one of `mapsDir`, `maps` and `loadMap` is required (otherwise `createResolver` throws a `TypeError`).
They are tried in the order `maps`, `loadMap`, `mapsDir`.

`resolve(stack)` returns a `Promise` of an array of frames. It never rejects: a stack that is not a string gives
`[]`, and a frame that cannot be mapped (no map, native code, a position the map does not cover) comes back as an
**unmapped** frame holding what the browser said.

### A frame

```js
{
  source: 'src/lib/cart.ts',   // original file; for unmapped frames the script URL without ?query and #fragment
  line: 9,                     // 1-based, null when the browser gave none
  column: 11,                  // 1-based, null when the browser gave none
  name: 'validateCart',        // function name, null for anonymous functions
  arguments: [],               // always empty; kept for 0.x consumers
  mapped: true,                // found in a source map?
  sourceLine: "throw new Error('cart is empty')"   // only with includeSource: true
}
```

The array also has a `stack` property: a readable rebuilt stack (`    at name (source:line:column)` lines). It is not
enumerable, so `JSON.stringify(frames)` holds only the frames. `formatStack(frames)` builds the same text from
frames you saved as JSON. The `Error: message` header is not a frame and is not included.

### How function names are found

A source map names the identifier at a *position*, which for a stack frame is the call the function made, so the
name at a frame's position is really the name of the function that frame's caller invoked. `resolve` uses that: the
name of frame *n* is the name the map has at the position of frame *n+1*. When the map has no name there, the
frame keeps the name the browser printed, with `Object.`-style receivers and `async`/`new` prefixes removed. For
minified code that name may be a minified one. Two cases to know:

* **Bun does not write `names` into its source maps** (`bun build --sourcemap`, Bun 1.3). File, line and column
  are exact, but function names stay as the browser printed them. Build the client with `--minify-whitespace
  --minify-syntax` (no `--minify-identifiers`) and the browser's own names are the real names. esbuild, Vite and
  webpack write `names`, and then you get the original names even when the identifiers are minified.
* Safari removes frames of functions that ended in a tail call, so there the name inferred from the caller can be
  the dropped function's name. File, line and column are not affected.

### Which map belongs to a frame

The file name in the frame's URL, without `?query` and `#fragment`, is the bundle name: `app-1a2b3c.js`,
`chunk-8d7s6a5f.js` (Bun), `main.5f3e9c.chunk.js` (webpack), `index-BzS2xa1Q.js` (Vite), `app-CQH66RKJ.js` (esbuild).
Its map is `<bundle name>.map` in `mapsDir`, or `maps['<bundle name>']`, or what `loadMap('<bundle name>')`
returns. The name must be a plain script file name (`.js`, `.mjs`, `.cjs`; no slashes, so it cannot leave
`mapsDir`). A name that merely *contains* another bundle's hash does not match. Index maps (`sections`) are not
supported.

### Source paths

Maps record file names in many styles. They come back as short project paths:

| In the map | Result |
|---|---|
| `../../src/lib/cart.ts` (relative to the output folder) | `src/lib/cart.ts` |
| `webpack:///./src/app.js`, `webpack://shop/./src/app.js?1a2b` | `src/app.js` |
| `/srv/build/shop/src/app.tsx` with `root: '/srv/build/shop'` | `src/app.tsx` |
| `file:///...`, `C:\\...`, Vite `/@fs/...` | handled the same way |
| anything in `node_modules` | `node_modules/<package>/...` |
| an absolute path outside `root` (or no `root`) | `src/...` from its last `src` folder, else its last two segments (which can include one folder name, so set `root`) |

Nothing returned for a mapped frame starts with `/`, a blank or a drive letter, and none of its segments is `..`, `.` or blank (blank includes invisible glyphs such as the Hangul filler and the Braille blank). Percent-encoding is not decoded: `%2e%2e` is an ordinary name. (An unmapped frame shows the URL the browser reported, which is client text.) Set `root`, and paths are exact.

### Safety

The stack and every name in it come from a browser you do not control.

* Only the first `maxStackLength` characters are read, at most `maxFrames` frames are returned, and a line over 2000
  characters is ignored. One stack opens at most `maxMapsPerStack` maps (frames of further bundles stay unmapped), so
  a page that names many chunks cannot make the server parse and hold many maps for one request. Misses and
  broken maps are not cached, so keep `mapsDir` and `loadMap` cheap.
* Control and direction-changing characters are removed from stack text and from map-supplied names, paths and source lines, so a frame cannot forge another one in your log. Unmapped frames
  still echo client text (function names, URLs): treat them as untrusted in logs.
* Only real maps are cached, in an LRU of `maxCachedMaps`. Names a page invents are never stored.
* A bundle name cannot contain a path separator, so `mapsDir` cannot be escaped.
* No input makes `resolve` throw or reject, including broken or hostile maps, and a throwing or rejecting `loadMap` or `onError`.

## Example: production error forensics with Bun and React 19

Browser errors go to a Bun server over [api-ape](https://github.com/codemeasandwich/api-ape). The server rebuilds the
stack with maps that production never serves, and logs it with
[scribbles](https://github.com/codemeasandwich/scribbles) in the request's trace.

### 1. Build, and keep the maps private

```sh
bun build ./client/index.tsx --outdir dist/public --target browser --minify --sourcemap=external \
  --entry-naming '[name]-[hash].[ext]' --chunk-naming 'chunk-[hash].[ext]' --splitting

mkdir -p private/maps && mv dist/public/*.map private/maps/     # production never serves .map files
```

Deploy `dist/public` to the web and `private/maps` next to the server. Pass `root` the absolute folder you ran the
build in. To get real function names from a Bun build use `--minify-whitespace --minify-syntax` instead of `--minify`
(see [How function names are found](#how-function-names-are-found)), or build the client with esbuild.

### 2. Client: capture every kind of browser error

```ts
// client/report-errors.ts
import api from 'api-ape'

const seen = new Set<string>()

function report(kind: string, error: unknown, componentStack?: string | null) {
  const e = error instanceof Error ? error : new Error(String(error))
  const key = `${kind}|${e.name}|${e.message}|${(e.stack ?? '').slice(0, 300)}`
  if (seen.has(key) || seen.size >= 50) return        // once per distinct error per page load
  seen.add(key)
  api.clientError({
    kind,
    name: e.name,
    message: e.message.slice(0, 500),
    stack: (e.stack ?? '').slice(0, 20000),
    componentStack: (componentStack ?? '').slice(0, 20000),
    page: location.pathname,
  }).catch(() => {})                                   // reporting must never throw
}

window.addEventListener('error', (event) => report('window.onerror', event.error ?? event.message))
window.addEventListener('unhandledrejection', (event) => report('unhandledrejection', event.reason))

// React 19 root options: errors React catches never reach window.onerror
export const reactErrorHandlers = {
  onUncaughtError: (error: unknown, info: { componentStack?: string }) => report('react.uncaught', error, info.componentStack),
  onCaughtError: (error: unknown, info: { componentStack?: string }) => report('react.caught', error, info.componentStack),
  // hydration mismatches are reported here, and React retries on the client
  onRecoverableError: (error: unknown, info: { componentStack?: string }) => report('react.recoverable', error, info.componentStack),
}
```

```tsx
// client/index.tsx
import { createRoot, hydrateRoot } from 'react-dom/client'
import { reactErrorHandlers } from './report-errors'
import { App } from './App'

const el = document.getElementById('root')!
if (el.hasChildNodes()) hydrateRoot(el, <App />, reactErrorHandlers)
else createRoot(el, reactErrorHandlers).render(<App />)
```

React gives `componentStack` in the same format as a V8 stack (`at Row (https://...:1:2)`), so it resolves too.

### 3. Server: resolve, log, group

```js
// api/clientError.js   (an api-ape controller: the browser calls api.clientError(payload))
const crypto = require('node:crypto')
const createResolver = require('resolve-browser-trace')
const scribbles = require('scribbles')

const resolve = createResolver({
  mapsDir: process.env.MAPS_DIR || '/srv/app/private/maps',
  root: '/srv/build/shop',
  onError: (error, { file }) => scribbles.warn('source map unusable', { file, error: String(error) }),
})

const text = (value, max) => (typeof value === 'string' ? value.slice(0, max) : '')

module.exports = async function clientError(payload) {
  if (typeof payload !== 'object' || payload === null) return { ok: false }
  const [frames, componentFrames] = await Promise.all([resolve(payload.stack), resolve(payload.componentStack)])
  const where = frames.filter((f) => f.mapped).slice(0, 3).map((f) => `${f.source}:${f.line}`)
  // the same bug gives the same fingerprint in every browser, so repeats can become one incident
  const fingerprint = crypto.createHash('sha1').update([payload.kind, payload.name, ...where].join('|')).digest('hex').slice(0, 12)

  scribbles.error('client error', {
    fingerprint,
    kind: text(payload.kind, 40),
    name: text(payload.name, 100),
    message: text(payload.message, 500),
    page: text(payload.page, 200),
    clientId: this.clientId,
    stack: frames.stack,
    components: componentFrames.filter((f) => f.mapped).map((f) => f.name),
    unmapped: frames.length > 0 && where.length === 0,   // true: the maps for this release are missing
  })
  return { ok: true, fingerprint }
}
```

`scribbles.error` called while api-ape handles the request is part of that request's trace; wrap the controller body in
`scribbles.trace('client-error', ...)` if you want a trace of its own. Count `fingerprint`s in your log pipeline, or
in the controller, to turn repeats into one incident.

### 4. A single-file server with the maps inside

`bun build --compile` has no maps folder at run time. Embed the maps and pass them as data (this is why the library
no longer uses the `source-map` package, which loads a `.wasm` file from disk):

```js
// scripts/embed-maps.js  (run after the client build)
const { readdirSync, writeFileSync } = require('node:fs')
const files = readdirSync('private/maps').filter((f) => f.endsWith('.map'))
writeFileSync('server/maps.generated.ts',
  files.map((f, i) => `import m${i} from '../private/maps/${f}' with { type: 'text' }`).join('\n') +
  `\nexport default { ${files.map((f, i) => `'${f.replace(/\.map$/, '')}': m${i}`).join(', ')} } as Record<string, string>\n`)
```

```ts
import createResolver from 'resolve-browser-trace'
import maps from './maps.generated'
export const resolve = createResolver({ maps, root: '/srv/build/shop' })
```

```sh
node scripts/embed-maps.js && bun build --compile server/main.ts --outfile shop-server
```

Maps for older releases keep working if you keep their files: the bundle name includes the content hash, so each
release's maps sit side by side. Use `loadMap` to fetch a release's map from object storage instead.

## Which stacks are understood

| Engine | Example frame |
|---|---|
| V8: Chrome, Edge, Node, Bun | `    at validateCart (https://host/app.js:1:301)`, `at async fn (...)`, `at new Foo (...)`, `at Object.m [as alias] (...)`, `at eval (eval at fn (url:1:2), <anonymous>:1:5)` |
| SpiderMonkey: Firefox | `validateCart@https://host/app.js:1:301`, `a/<@...`, `async*fn@...`, `promise callback*fn@...` |
| JavaScriptCore: Safari | `validateCart@https://host/app.js:1:301`, `global code@...`, `eval code@...`, `map@[native code]` |
| React `componentStack` | `    at Row (https://host/app.js:1:301)` (lines such as `at div` that name no place are skipped) |

Lines that are not frames (the `TypeError: message` header, blank lines) are skipped.

## Upgrading from 0.x

1.0.0 is a rewrite of the internals with the same calling convention (`require('resolve-browser-trace')(mapsDir)`
still returns a function that takes a stack and returns a promise of frames). What changed, and how to adapt, is
in [CHANGELOG.md](CHANGELOG.md#100).

## Development

```sh
npm install
npm test            # jest with a 100% coverage threshold
npm run test:types  # the TypeScript consumers in test/types
npm run fixtures    # rebuild test/fixtures/dist (needs bun and esbuild)
node scripts/capture-stacks.js chrome firefox edge webkit node bun   # re-record stacks from real browsers
npm run release     # create a GitHub release; the publish workflow does the npm publish
```

The tests are user stories through the public API, run against bundles that `bun build --minify` and esbuild
produced from the TSX app in `test/fixtures/src`, and against `error.stack` strings recorded from real Chrome, Edge,
Firefox, Safari (WebKit), Node and Bun running those bundles. `npm install` installs the git hooks from `.hooks`
(conventional commit subjects, and on `main`/`master` the 100% coverage check).

## License

Apache-2.0, see [LICENSE](LICENSE).

### If this was helpful, [★ it on github](https://github.com/codemeasandwich/resolve-browser-trace)
