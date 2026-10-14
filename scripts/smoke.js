#!/usr/bin/env node
// Resolves a recorded Chrome stack against the fixture maps, passed as data (`maps`), and checks the answer.
// The CI "Bun" job runs it under Bun; it runs under Node too.
//
//   node scripts/smoke.js      bun scripts/smoke.js

const assert = require('node:assert')
const fs = require('node:fs')
const path = require('node:path')
const createResolver = require('..')

const fixtures = path.join(__dirname, '..', 'test', 'fixtures')
const manifest = JSON.parse(fs.readFileSync(path.join(fixtures, 'dist', 'manifest.json'), 'utf8'))
const chrome = JSON.parse(fs.readFileSync(path.join(fixtures, 'stacks', 'chrome.json'), 'utf8'))

const maps = {}
for (const [variant, { maps: files }] of Object.entries(manifest)) {
  for (const name of files) {
    maps[name.replace(/\.map$/, '')] = fs.readFileSync(path.join(fixtures, 'dist', variant, name), 'utf8')
  }
}

const resolve = createResolver({ maps })
resolve(chrome.variants.esbuild.emptyCheckout).then((frames) => {
  assert.deepStrictEqual(
    frames.slice(0, 3).map((f) => `${f.name} ${f.source}:${f.line}:${f.column}`),
    ['validateCart src/lib/cart.ts:9:11', 'checkout src/lib/cart.ts:14:3', 'emptyCheckout src/app.tsx:10:12']
  )
  console.log('smoke ok')
})
