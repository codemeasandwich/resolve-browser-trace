#!/usr/bin/env node
// Builds the real bundles and source maps the test-suite resolves stacks against.
//
//   npm run fixtures
//
// Input : test/fixtures/src/**            (a small TSX "shop" app: cart, pricing, a JSX view, a lazy chunk)
// Output: test/fixtures/dist/<variant>/   (minified bundles + external maps, content-hashed names)
//         test/fixtures/dist/manifest.json
//
// Variants (each is a different bundler / naming scheme the library must cope with):
//   bun        bun build --minify --sourcemap=external, one file         app-<hash>.js
//   bun-split  bun build --splitting, entry + shared chunk + lazy chunk   app-<hash>.js, lazy-<hash>.js
//   esbuild    esbuild --bundle --minify, one IIFE file                   app-<HASH>.js
//   esbuild-split esbuild ESM with chunk-<HASH>.js chunks                 app-<HASH>.js, chunk-<HASH>.js
//
// The outputs are committed, so the tests need neither bun nor esbuild. Re-running this script changes
// the content hashes (and therefore the recorded stacks in test/fixtures/stacks) only if the sources
// or the bundler versions change; re-run scripts/capture-stacks.js afterwards.
//
// Requires: bun on PATH, and esbuild (devDependency).

const { execFileSync } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '..')
const fixtures = path.join(root, 'test', 'fixtures')
const dist = path.join(fixtures, 'dist')
const entry = path.join('test', 'fixtures', 'src', 'app.tsx')
const esbuild = path.join(root, 'node_modules', '.bin', 'esbuild')

function run(cmd, args) {
  execFileSync(cmd, args, { cwd: root, stdio: ['ignore', 'ignore', 'inherit'] })
}

const variants = {
  bun: (out) =>
    run('bun', ['build', entry, '--minify', '--sourcemap=external', '--outdir', out, '--entry-naming', '[name]-[hash].[ext]']),
  'bun-split': (out) =>
    run('bun', ['build', entry, '--minify', '--sourcemap=external', '--splitting', '--outdir', out, '--entry-naming', '[name]-[hash].[ext]']),
  esbuild: (out) =>
    run(esbuild, [entry, '--bundle', '--minify', '--sourcemap', '--format=iife', `--outdir=${out}`, '--entry-names=[name]-[hash]', '--log-level=warning']),
  'esbuild-split': (out) =>
    run(esbuild, [entry, '--bundle', '--minify', '--sourcemap', '--format=esm', '--splitting', `--outdir=${out}`, '--entry-names=[name]-[hash]', '--chunk-names=chunk-[hash]', '--log-level=warning']),
}

fs.rmSync(dist, { recursive: true, force: true })
const manifest = {}
for (const [name, build] of Object.entries(variants)) {
  const out = path.join(dist, name)
  fs.mkdirSync(out, { recursive: true })
  build(out)
  const files = fs.readdirSync(out).sort()
  manifest[name] = {
    bundles: files.filter((f) => f.endsWith('.js')),
    maps: files.filter((f) => f.endsWith('.js.map')),
  }
  // The scripts must not carry the sourceMappingURL/debugId comments that tell a browser where the map is:
  // production never serves .map files, and neither do these fixtures.
  for (const bundle of manifest[name].bundles) {
    const file = path.join(out, bundle)
    const code = fs.readFileSync(file, 'utf8').replace(/^\/\/# (sourceMappingURL|debugId)=.*$/gm, '').trimEnd() + '\n'
    fs.writeFileSync(file, code)
  }
}
fs.writeFileSync(path.join(dist, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n')
console.log(JSON.stringify(manifest, null, 2))
