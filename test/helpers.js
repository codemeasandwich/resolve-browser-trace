'use strict'

// Shared by the scenario tests. Everything here reads the generated fixtures (see scripts/make-fixtures.js and
// scripts/capture-stacks.js); nothing here touches the library under test.

const fs = require('node:fs')
const path = require('node:path')

const fixtures = path.join(__dirname, 'fixtures')
const dist = path.join(fixtures, 'dist')
const manifest = JSON.parse(fs.readFileSync(path.join(dist, 'manifest.json'), 'utf8'))

// The repository folder the fixtures were bundled in: a bundler records its sources relative to its output folder.
const PROJECT_ROOT = path.resolve(__dirname, '..')

/** Folder with the bundles and `<bundle>.map` files of one variant: bun, bun-split, esbuild, esbuild-split. */
function mapsDir(variant) {
  return path.join(dist, variant)
}

/** The bundle file names of a variant, e.g. ['app-pf2qqq1g.js']. */
function bundles(variant) {
  return manifest[variant].bundles
}

/** The first bundle of a variant that starts with `prefix` ('app-', 'lazy-', 'chunk-'). */
function bundle(variant, prefix) {
  return bundles(variant).find((name) => name.startsWith(prefix))
}

/** The parsed source map JSON of a bundle. */
function readMap(variant, bundleName) {
  return JSON.parse(fs.readFileSync(path.join(dist, variant, `${bundleName}.map`), 'utf8'))
}

/** { browser, userAgent, origin, variants: { <variant>: { <scenario>: <real error.stack> } } } */
function recordedStacks(browser) {
  return JSON.parse(fs.readFileSync(path.join(fixtures, 'stacks', `${browser}.json`), 'utf8'))
}

/** A copy of a real source map with every `sources` entry rewritten, to look like another bundler's output. */
function withSources(map, rewrite) {
  return { ...map, sources: map.sources.map(rewrite) }
}

module.exports = { PROJECT_ROOT, mapsDir, bundles, bundle, readMap, recordedStacks, withSources, manifest }
