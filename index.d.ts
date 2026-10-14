/**
 * resolve-browser-trace: rebuild minified browser stacks into original source locations on the server.
 *
 * ```js
 * const createResolver = require('resolve-browser-trace')
 * const resolve = createResolver({ mapsDir: '/srv/private/maps', root: '/srv/build/shop' })
 * const frames = await resolve(errorFromTheBrowser.stack)
 * ```
 */
declare function createResolver(options: string | createResolver.Options): createResolver.Resolver

declare namespace createResolver {
  /** A source map as JSON text, as bytes (for example `fs.readFileSync`), or as the parsed object. */
  type SourceMapInput = string | Uint8Array | { version: number; [key: string]: unknown }

  interface Options {
    /**
     * Folder holding `<bundle file name>.map` files, e.g. `app-1a2b3c.js.map` for `https://host/app-1a2b3c.js`.
     * A map is read the first time its bundle shows up, so maps copied there after startup are found.
     * Once loaded it stays cached until evicted (see `maxCachedMaps`); use new file names (content hashes do) to replace it.
     */
    mapsDir?: string
    /** Maps in memory, keyed by bundle file name: `{ 'app-1a2b3c.js': mapJsonOrObject }`. Parsed when first needed, then cached. */
    maps?: Record<string, SourceMapInput>
    /**
     * Called with a bundle file name that looks like a plain script file name; return its map, or null/undefined when you
     * have none. The name comes from the client: treat it as untrusted. Consulted after `maps`, before `mapsDir`.
     * Misses are not cached and there is no timeout: one stack can call this up to `maxMapsPerStack` times, so cache
     * misses and bound the time yourself if it talks to a database or the network.
     */
    loadMap?: (fileName: string) => SourceMapInput | null | undefined | Promise<SourceMapInput | null | undefined>
    /**
     * The folder your bundler ran in. Source paths below it are returned relative to it
     * (`/srv/build/shop/src/app.tsx` becomes `src/app.tsx`).
     */
    root?: string
    /** Add `sourceLine` (the original line of code, from the map's `sourcesContent`) to mapped frames. Default false. */
    includeSource?: boolean
    /** Called when a map exists but cannot be loaded or parsed. A missing map is not an error. */
    onError?: (error: unknown, info: { file: string }) => unknown
    /** Longest stack text read, in characters; the rest is ignored. Default 65536. */
    maxStackLength?: number
    /** Most frames returned for one stack. Default 100. */
    maxFrames?: number
    /** Parsed maps kept in memory (least recently used leave first). Default 16. */
    maxCachedMaps?: number
    /** Largest map accepted, in characters of JSON (64 MiB). Bigger maps, or maps with over two million generated lines, are reported to `onError` and not used. */
    maxMapBytes?: number
    /** Most maps opened for one stack; frames of further bundles stay unmapped. Default 4. */
    maxMapsPerStack?: number
  }

  interface Frame {
    /** Original file (`src/lib/cart.ts`) when mapped; the script URL without query or fragment when not. */
    source: string | null
    /** 1-based line, or null when the frame has none (`<anonymous>`, `[native code]`) or it is not a usable number. */
    line: number | null
    /** 1-based column, or null. */
    column: number | null
    /** Function name, or null for anonymous functions. */
    name: string | null
    /** Always empty; kept so 0.x consumers that read it keep working. */
    arguments: string[]
    /** True when the frame was found in a source map. */
    mapped: boolean
    /** Original line of code. Only present with `includeSource: true`; null when the map has no `sourcesContent`. */
    sourceLine?: string | null
  }

  /** The frames, plus `.stack`: a readable rebuilt stack (not enumerable, so it is not part of the JSON). */
  type Frames = Frame[] & { readonly stack: string }

  /** Never rejects. Anything that is not stack text, or cannot be read, gives an empty array or unmapped frames. */
  type Resolver = (stack: unknown) => Promise<Frames>

  function createResolver(options: string | Options): Resolver
  /** Same as `createResolver`; the name the 0.x versions used. */
  function setup(options: string | Options): Resolver
  /** Renders frames as `    at name (source:line:column)` lines. */
  function formatStack(frames: ReadonlyArray<Pick<Frame, 'source' | 'line' | 'column' | 'name'>>): string
}

export = createResolver
