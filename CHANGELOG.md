# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project follows
[Semantic Versioning](https://semver.org/).

## 1.0.0

A modernisation for production error forensics: browser errors (`window.onerror`, `unhandledrejection`, React 19
`onUncaughtError` / `onCaughtError` / `onRecoverableError`) are sent to a server, which rebuilds the minified stack
from source maps it keeps private. The calling convention is unchanged:
`require('resolve-browser-trace')(mapsDir)(stack)` still returns a promise of frames. Everything else below is new
or fixed, and the second list is what can change your results.

### Added

- `createResolver(options)` (also exported as `setup`) with `mapsDir`, `maps` (maps in memory, as JSON text, a Buffer
  or an object, so a `bun build --compile` binary can embed them), `loadMap(fileName)`, `root`, `includeSource`,
  `onError`, `maxStackLength`, `maxFrames` and `maxCachedMaps`. `createResolver('<folder>')` still works.
- `mapped` on every frame; `frames.stack`, a readable rebuilt stack (not enumerable, so not in the JSON);
  `formatStack(frames)`; optional `sourceLine` (the original line of code from `sourcesContent`).
- Stack parsers for Chrome / Edge / Node / Bun (V8), Firefox (SpiderMonkey) and Safari (JavaScriptCore), including
  async frames, `new`, method aliases, eval origins, `async*`, `promise callback*`, `global code`, `eval code`,
  `[native code]` and React `componentStack` text.
- TypeScript types (`index.d.ts`, `index.d.mts`), an ES module entry (`index.mjs`) and an `exports` map.
- Tests that are user stories run against real bundles (`bun build --minify` and esbuild, with and without code
  splitting) and `error.stack` strings recorded from Chrome, Edge, Firefox, Safari (WebKit), Node and Bun, with a
  100% coverage threshold. `LICENSE` (Apache-2.0), GitHub Actions for tests and for publishing with provenance,
  a release script and git hooks.

### Fixed

- A `mapsDir` that did not exist crashed the process (`files` was `undefined` inside an `fs.readdir` callback).
  Frames now come back unmapped.
- A frame with no function name and no map threw (`methodName.replace` of `null`), and a non-string stack threw.
  `resolve` never throws or rejects now; frames it cannot map are returned unmapped.
- A map was chosen by `file.includes(sha)`, so a map whose name merely contained the bundle's name could win.
  Maps are matched by the exact bundle file name.
- Every new bundle name listed the whole maps folder with `fs.readdir`. The exact `<name>.map` is read instead.
- The cache was keyed by client-controlled text and grew without limit; consumers were never destroyed, leaking
  WebAssembly memory. The cache is now an LRU of parsed maps, only real maps are cached, and input is capped
  (65536 characters, 100 frames, 2000 characters per line).
- Stack columns count from 1 and source map columns from 0, but the stack column was used as it was, so lookups
  were one column off. The "Chrome parse fix" workaround is gone because the parser reads the line and column itself.
- Content-hashed names from Bun (`[name]-[hash].js`, `chunk-<hash>.js`), webpack, Vite and esbuild, and URLs with
  query strings and fragments, are matched; the old name test only used the text before the first dot.
- The `global.fetch` workaround for `source-map` 0.7 and the WebAssembly it loaded are gone.
- Absolute build-machine paths in `sources` were returned as they were. See below.

### Changed (behaviour that can differ from 0.x)

- **Map file names.** A bundle `app-1a2b.js` needs `app-1a2b.js.map`. 0.x matched the first `.map` file whose
  name contained `app-1a2b`, so `main-<hash>.map.js` style names no longer match; rename them, or use `maps` or
  `loadMap`. Bundle names must be plain script names ending in `.js`, `.mjs` or `.cjs`.
- **Columns.** Frames report 1-based columns (like the stack and like editors) and are looked up with the correct
  0-based column. Expect `column` to be different from 0.x.
- **Names.** `name` is the function the frame is running, found from the caller's call position in the map, else the
  name the browser printed (with receivers such as `Object.` and `async` / `new` prefixes removed). 0.x returned the
  identifier at the frame's own position, which is the function that was *called* from there. An unknown name is
  `null` (0.x: missing).
- **Sources.** `source` is a short project path: `webpack://`, `file://`, `/@fs/` and query strings are removed, paths
  are made relative to `root`, and anything else absolute is cut down. For unmapped frames `source` is the script URL
  without query and fragment. Nothing absolute is returned.
- **Unmappable frames.** They are returned (`mapped: false`) with the browser's own values. Lines of a stack that
  are not frames are skipped.
- **Limits.** Input over `maxStackLength` is cut and frames over `maxFrames` are dropped.
- `arguments` is always `[]`.
- **Dependencies.** `source-map` and `stacktrace-parser` are replaced by `@jridgewell/trace-mapping` (pure
  JavaScript, no WebAssembly, so it also works inside a compiled Bun binary). Node 18 or later. Index maps
  (`sections`) are not supported.
- The package has an `exports` map, so deep imports such as `resolve-browser-trace/index.js` are no longer
  allowed, and the tarball no longer contains the example folder (it is replaced by the README's Bun + React
  example).
- The `license` field is the SPDX id `Apache-2.0` (it was `apache 2`), and the repository has a `LICENSE` file.

## 0.10.1

Last 0.x release (January 2023).
