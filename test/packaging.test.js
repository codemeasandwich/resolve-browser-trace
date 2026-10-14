'use strict'

const { execFileSync, spawnSync } = require('node:child_process')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { PROJECT_ROOT, mapsDir, recordedStacks } = require('./helpers')

// "Someone installs the package and uses it from CommonJS, from an ES module or from TypeScript." These tests use
// the package the way a consumer does: by its name, through the "exports" map, in a separate process.

const stack = JSON.stringify(recordedStacks('chrome').variants.esbuild.emptyCheckout)
const program = (loader) => `
  ${loader}
  const resolve = createResolver(${JSON.stringify(mapsDir('esbuild'))})
  resolve(${stack}).then((frames) => console.log(JSON.stringify({ kind: typeof createResolver, setup: typeof setup, format: typeof formatStack, first: frames[0].source, text: frames.stack.split('\\n')[0] })))
`

function run(args) {
  return JSON.parse(execFileSync(process.execPath, args, { cwd: PROJECT_ROOT, encoding: 'utf8' }))
}

describe('using the package by name', () => {
  test('require("resolve-browser-trace") gives the resolver function with setup and formatStack attached', () => {
    const out = run(['-e', program(`const createResolver = require('resolve-browser-trace'); const { setup, formatStack } = createResolver`)])
    expect(out).toEqual({ kind: 'function', setup: 'function', format: 'function', first: 'src/lib/cart.ts', text: '    at validateCart (src/lib/cart.ts:9:11)' })
  })

  test('import from an ES module gives the default and the named exports', () => {
    const out = run(['--input-type=module', '-e', program(`import createResolver, { setup, formatStack, createResolver as named } from 'resolve-browser-trace'; if (named !== createResolver) throw new Error('named !== default')`)])
    expect(out).toMatchObject({ kind: 'function', setup: 'function', format: 'function' })
  })

  test('a TypeScript consumer sees correct types from CommonJS and from ESM', () => {
    const result = spawnSync(process.execPath, [path.join(PROJECT_ROOT, 'node_modules', 'typescript', 'bin', 'tsc'), '-p', path.join(__dirname, 'types', 'tsconfig.json')], { cwd: PROJECT_ROOT, encoding: 'utf8' })
    expect(result.stdout + result.stderr).toBe('')
    expect(result.status).toBe(0)
  }, 60000)

  test('the types reject a wrong call', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rbt-types-'))
    fs.writeFileSync(path.join(dir, 'bad.cts'), "import createResolver = require('resolve-browser-trace')\ncreateResolver(42)\ncreateResolver({ mapsDir: 1 })\n")
    fs.writeFileSync(path.join(dir, 'tsconfig.json'), JSON.stringify({ extends: path.join(__dirname, 'types', 'tsconfig.json'), files: ['bad.cts'], compilerOptions: { typeRoots: [] } }))
    fs.mkdirSync(path.join(dir, 'node_modules'))
    fs.symlinkSync(PROJECT_ROOT, path.join(dir, 'node_modules', 'resolve-browser-trace'), 'dir') // what a consumer's install looks like
    const result = spawnSync(process.execPath, [path.join(PROJECT_ROOT, 'node_modules', 'typescript', 'bin', 'tsc'), '-p', path.join(dir, 'tsconfig.json')], { cwd: dir, encoding: 'utf8' })
    expect(result.status).not.toBe(0)
    expect(result.stdout).toMatch(/bad\.cts\(2,/)
    expect(result.stdout).toMatch(/bad\.cts\(3,/)
  }, 60000)
})

describe('what is published', () => {
  const pack = JSON.parse(execFileSync('npm', ['pack', '--dry-run', '--json', '--ignore-scripts'], { cwd: PROJECT_ROOT, encoding: 'utf8' }))[0]
  const published = pack.files.map((f) => f.path)

  test('the tarball holds the library, its types, the licence and the docs', () => {
    expect(published).toEqual(
      expect.arrayContaining(['package.json', 'index.js', 'index.mjs', 'index.d.ts', 'index.d.mts', 'LICENSE', 'README.md', 'CHANGELOG.md', 'src/map-store.js', 'src/parse-stack.js', 'src/source-path.js', 'src/format.js'])
    )
  })

  test('it holds no tests, fixtures, scripts, hooks, workflows or build output', () => {
    expect(published.filter((p) => /^(test|scripts|\.hooks|\.github|coverage|example|examples)\//.test(p))).toEqual([])
    expect(published.every((p) => ['package.json', 'index.js', 'index.mjs', 'index.d.ts', 'index.d.mts', 'LICENSE', 'README.md', 'CHANGELOG.md'].includes(p) || p.startsWith('src/'))).toBe(true)
  })

  test('the licence in package.json is the licence in the LICENSE file', () => {
    const manifest = JSON.parse(fs.readFileSync(path.join(PROJECT_ROOT, 'package.json'), 'utf8'))
    expect(manifest.license).toBe('Apache-2.0')
    expect(fs.readFileSync(path.join(PROJECT_ROOT, 'LICENSE'), 'utf8')).toMatch(/Apache License\s+Version 2\.0, January 2004/)
    expect(fs.readFileSync(path.join(PROJECT_ROOT, 'README.md'), 'utf8')).toMatch(/Apache-2\.0|Apache 2\.0/)
  })

  test('there is one small runtime dependency, an engines range and a version of 1.0.0 or later', () => {
    const manifest = JSON.parse(fs.readFileSync(path.join(PROJECT_ROOT, 'package.json'), 'utf8'))
    expect(Object.keys(manifest.dependencies)).toEqual(['@jridgewell/trace-mapping'])
    expect(manifest.engines.node).toMatch(/^>=\d+/)
    expect(+manifest.version.split('.')[0]).toBeGreaterThanOrEqual(1)
  })
})

describe('the git hooks', () => {
  function hooksOf(repo) {
    return fs.readdirSync(path.join(repo, '.git', 'hooks'))
  }

  test('npm install in a clone installs the commit-msg and pre-commit hooks; in a folder without git it does nothing', () => {
    const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'rbt-hooks-'))
    execFileSync('git', ['init', '-q'], { cwd: repo })
    fs.cpSync(path.join(PROJECT_ROOT, '.hooks'), path.join(repo, '.hooks'), { recursive: true })
    fs.mkdirSync(path.join(repo, 'scripts'))
    fs.copyFileSync(path.join(PROJECT_ROOT, 'scripts', 'install-hooks.js'), path.join(repo, 'scripts', 'install-hooks.js'))
    const out = execFileSync(process.execPath, ['scripts/install-hooks.js'], { cwd: repo, encoding: 'utf8' })
    expect(out).toMatch(/git hooks installed/)
    expect(hooksOf(repo)).toEqual(expect.arrayContaining(['commit-msg', 'pre-commit', 'pre-commit.d']))
    expect(fs.statSync(path.join(repo, '.git', 'hooks', 'pre-commit')).mode & 0o111).not.toBe(0)

    const bare = fs.mkdtempSync(path.join(os.tmpdir(), 'rbt-nogit-'))
    fs.mkdirSync(path.join(bare, 'scripts'))
    fs.copyFileSync(path.join(PROJECT_ROOT, 'scripts', 'install-hooks.js'), path.join(bare, 'scripts', 'install-hooks.js'))
    expect(execFileSync(process.execPath, ['scripts/install-hooks.js'], { cwd: bare, encoding: 'utf8' })).toBe('')
  })

  test('when core.hooksPath is set (hooks shared by many repositories) nothing is written there', () => {
    const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'rbt-shared-'))
    const shared = fs.mkdtempSync(path.join(os.tmpdir(), 'rbt-shared-hooks-'))
    fs.writeFileSync(path.join(shared, 'pre-commit'), '#!/bin/sh\necho theirs\n')
    execFileSync('git', ['init', '-q'], { cwd: repo })
    execFileSync('git', ['config', 'core.hooksPath', shared], { cwd: repo })
    fs.cpSync(path.join(PROJECT_ROOT, '.hooks'), path.join(repo, '.hooks'), { recursive: true })
    fs.mkdirSync(path.join(repo, 'scripts'))
    fs.copyFileSync(path.join(PROJECT_ROOT, 'scripts', 'install-hooks.js'), path.join(repo, 'scripts', 'install-hooks.js'))
    expect(execFileSync(process.execPath, ['scripts/install-hooks.js'], { cwd: repo, encoding: 'utf8' })).toMatch(/core\.hooksPath is set/)
    expect(fs.readdirSync(shared)).toEqual(['pre-commit'])
    expect(fs.readFileSync(path.join(shared, 'pre-commit'), 'utf8')).toContain('theirs')
  })

  test('the commit-msg hook accepts "<type>: <summary>" and refuses other subjects', () => {
    const hook = path.join(PROJECT_ROOT, '.hooks', 'commit-msg')
    const check = (subject) => {
      const msg = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'rbt-msg-')), 'MSG')
      fs.writeFileSync(msg, `${subject}\n`)
      return spawnSync('bash', [hook, msg]).status
    }
    expect(check('feat: add a thing')).toBe(0)
    expect(check('fix!: break a thing')).toBe(0)
    expect(check('added a thing')).toBe(1)
    expect(check(`feat: ${'x'.repeat(80)}`)).toBe(1)
  })
})
