'use strict'

// Runs a fixture bundle in a fresh vm context under a pretend https URL and returns the real `error.stack`
// of every scenario in test/fixtures/src/app.tsx. Works on Node and Bun (only for the single-file variants:
// the split variants are ES modules and are recorded from browsers instead).
//
//   node test/fixtures/harness.js <variant>      prints {"<scenario>": "<stack>"} as JSON

const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')

const SCENARIOS = ['emptyCheckout', 'quoteNegative', 'bigDiscount', 'blankRow', 'rejectLater', 'lazyFailure']
const dist = path.join(__dirname, 'dist')
const ORIGIN = 'https://shop.example.com/assets/'

async function runScenarios(variant) {
  const manifest = JSON.parse(fs.readFileSync(path.join(dist, 'manifest.json'), 'utf8'))
  const [bundle] = manifest[variant].bundles
  const code = fs.readFileSync(path.join(dist, variant, bundle), 'utf8')
  const context = vm.createContext({})
  new vm.Script(code, { filename: ORIGIN + bundle }).runInContext(context)
  const stacks = {}
  for (const name of SCENARIOS) {
    try {
      await context.scenarios[name]()
      stacks[name] = null
    } catch (error) {
      // keep the frames of the bundle; drop this harness and the runtime's own frames below it (they carry local paths)
      const lines = String(error.stack).split('\n')
      const own = lines.findIndex((line) => line.includes(__filename))
      stacks[name] = lines.slice(0, own).join('\n')
    }
  }
  return { bundle, stacks }
}

module.exports = { runScenarios, SCENARIOS, ORIGIN }

if (require.main === module) {
  runScenarios(process.argv[2]).then(({ stacks }) => console.log(JSON.stringify(stacks)))
}
