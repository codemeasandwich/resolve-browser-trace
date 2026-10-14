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

// `npm pack --json` prints JSON on stdout. Some npm versions (10, as on CI) run the "prepare" script even with
// --ignore-scripts, and a script that prints would corrupt that JSON, so take the JSON from its own first line.
function packJson(folder, env = {}) {
  const out = execFileSync('npm', ['pack', '--dry-run', '--json', '--ignore-scripts'], {
    cwd: folder,
    encoding: 'utf8',
    env: { ...process.env, npm_config_ignore_scripts: 'true', ...env },
  })
  return JSON.parse(out.slice(out.search(/^\[/m)))[0]
}

describe('what is published', () => {
  const pack = packJson(PROJECT_ROOT)
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

  function repoWithScript() {
    const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'rbt-hooks-'))
    execFileSync('git', ['init', '-q'], { cwd: repo })
    copyScript(repo)
    return repo
  }
  function copyScript(folder) {
    fs.cpSync(path.join(PROJECT_ROOT, '.hooks'), path.join(folder, '.hooks'), { recursive: true })
    fs.mkdirSync(path.join(folder, 'scripts'), { recursive: true })
    fs.copyFileSync(path.join(PROJECT_ROOT, 'scripts', 'install-hooks.js'), path.join(folder, 'scripts', 'install-hooks.js'))
  }
  // what `npm install` runs, on a developer's machine (CI is not set) unless the test says otherwise.
  // npm reads stdout of `npm pack --json`, so the script must never write to it.
  function install(folder, env = {}) {
    const clean = { ...process.env }
    delete clean.CI
    const result = spawnSync(process.execPath, ['scripts/install-hooks.js'], { cwd: folder, encoding: 'utf8', env: { ...clean, ...env } })
    expect(result.stdout).toBe('')
    return result
  }

  test('npm install in a clone installs the commit-msg and pre-commit hooks; in a folder without git it does nothing', () => {
    const repo = repoWithScript()
    expect(install(repo).stderr).toMatch(/git hooks installed/)
    expect(hooksOf(repo)).toEqual(expect.arrayContaining(['commit-msg', 'pre-commit', 'pre-commit.d']))
    expect(fs.statSync(path.join(repo, '.git', 'hooks', 'pre-commit')).mode & 0o111).not.toBe(0)

    const bare = fs.mkdtempSync(path.join(os.tmpdir(), 'rbt-nogit-'))
    copyScript(bare)
    expect(install(bare).stderr).toBe('')
  })

  test('on a CI machine (CI is set) it does nothing at all', () => {
    const repo = repoWithScript()
    const result = install(repo, { CI: 'true' })
    expect(result.status).toBe(0)
    expect(result.stderr).toBe('')
    expect(hooksOf(repo).filter((f) => !f.endsWith('.sample'))).toEqual([])
  })

  test('unpacked inside somebody else\'s repository (a git dependency in node_modules), it leaves that repository\'s hooks alone', () => {
    const outer = fs.mkdtempSync(path.join(os.tmpdir(), 'rbt-outer-'))
    execFileSync('git', ['init', '-q'], { cwd: outer })
    const inner = path.join(outer, 'node_modules', 'resolve-browser-trace')
    copyScript(inner)
    const result = install(inner)
    expect(result.status).toBe(0)
    expect(result.stderr).toBe('')
    expect(fs.readdirSync(path.join(outer, '.git', 'hooks')).filter((f) => !f.endsWith('.sample'))).toEqual([])
  })

  test('a hooks folder that cannot be written does not make npm install fail (exit 0, says so)', () => {
    if (process.getuid && process.getuid() === 0) {
      return // root can write anywhere
    }
    const repo = repoWithScript()
    const hooks = path.join(repo, '.git', 'hooks')
    fs.chmodSync(hooks, 0o555)
    try {
      const result = install(repo)
      expect(result.status).toBe(0)
      expect(result.stderr).toMatch(/git hooks not installed \(/)
      expect(fs.readdirSync(hooks).filter((f) => !f.endsWith('.sample'))).toEqual([])
    } finally {
      fs.chmodSync(hooks, 0o755)
    }
  })

  test('if the developer already has any of the hooks (even a dangling link) none is installed: all or none', () => {
    const repo = repoWithScript()
    fs.symlinkSync('/nonexistent/hook', path.join(repo, '.git', 'hooks', 'commit-msg'))
    const result = install(repo)
    expect(result.status).toBe(0)
    expect(result.stderr).toMatch(/not installed: you already have commit-msg/)
    expect(fs.existsSync(path.join(repo, '.git', 'hooks', 'pre-commit'))).toBe(false)
    expect(fs.readlinkSync(path.join(repo, '.git', 'hooks', 'commit-msg'))).toBe('/nonexistent/hook')
  })

  test('running it again when its own hooks are already there says they are up to date and changes nothing', () => {
    const repo = repoWithScript()
    expect(install(repo).stderr).toMatch(/git hooks installed/)
    const hook = path.join(repo, '.git', 'hooks', 'pre-commit')
    const before = fs.statSync(hook).mtimeMs
    const again = install(repo)
    expect(again.status).toBe(0)
    expect(again.stderr).toBe('resolve-browser-trace: git hooks up to date\n')
    expect(fs.statSync(hook).mtimeMs).toBe(before)
  })

  test('if one of its own hooks went missing, running it again installs the set again', () => {
    const repo = repoWithScript()
    install(repo)
    fs.rmSync(path.join(repo, '.git', 'hooks', 'pre-commit.d'), { recursive: true })
    expect(install(repo).stderr).toMatch(/git hooks installed/)
    expect(fs.existsSync(path.join(repo, '.git', 'hooks', 'pre-commit.d', 'check-coverage.sh'))).toBe(true)
  })

  test('a hook the developer already has is kept as it is', () => {
    const repo = repoWithScript()
    fs.writeFileSync(path.join(repo, '.git', 'hooks', 'pre-commit'), '# my own hook\n')
    install(repo)
    expect(fs.readFileSync(path.join(repo, '.git', 'hooks', 'pre-commit'), 'utf8')).toBe('# my own hook\n')
    expect(fs.existsSync(path.join(repo, '.git', 'hooks', 'commit-msg'))).toBe(false)
  })

  test('when core.hooksPath is set (hooks shared by many repositories) nothing is written there', () => {
    const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'rbt-shared-'))
    const shared = fs.mkdtempSync(path.join(os.tmpdir(), 'rbt-shared-hooks-'))
    fs.writeFileSync(path.join(shared, 'pre-commit'), '#!/bin/sh\necho theirs\n')
    execFileSync('git', ['init', '-q'], { cwd: repo })
    execFileSync('git', ['config', 'core.hooksPath', shared], { cwd: repo })
    copyScript(repo)
    expect(install(repo).stderr).toMatch(/core\.hooksPath is set/)
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
    expect(check('fix(parser): handle async frames')).toBe(0)
    expect(check('feat(api)!: rename a thing')).toBe(0)
    expect(check('feat(): empty scope')).toBe(1)
    expect(check('added a thing')).toBe(1)
    expect(check(`feat: ${'x'.repeat(80)}`)).toBe(1)
  })
})

describe('npm pack on a fresh checkout, the way CI runs it', () => {
  // A copy of the working tree as git would hand it over: tracked and not-ignored files, a new repository, no hooks
  // installed, no node_modules. Older npm runs "prepare" for `npm pack` even with --ignore-scripts; forcing the
  // script to run (npm_config_ignore_scripts=false) reproduces that on any npm.
  function freshCheckout() {
    const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'rbt-fresh-'))
    const files = execFileSync('git', ['ls-files', '-co', '--exclude-standard'], { cwd: PROJECT_ROOT, encoding: 'utf8' }).split('\n').filter(Boolean)
    for (const file of files) {
      if (fs.existsSync(path.join(PROJECT_ROOT, file))) {
        fs.mkdirSync(path.dirname(path.join(folder, file)), { recursive: true })
        fs.copyFileSync(path.join(PROJECT_ROOT, file), path.join(folder, file))
      }
    }
    execFileSync('git', ['init', '-q'], { cwd: folder })
    return folder
  }
  const withoutCi = () => {
    const env = { ...process.env }
    delete env.CI
    return env
  }
  const hooksInstalled = (folder) => fs.readdirSync(path.join(folder, '.git', 'hooks')).filter((f) => !f.endsWith('.sample'))

  test('with CI set and prepare forced to run, stdout is pure JSON listing the package, and no hooks are installed', () => {
    const folder = freshCheckout()
    const out = execFileSync('npm', ['pack', '--dry-run', '--json'], { cwd: folder, encoding: 'utf8', env: { ...process.env, CI: 'true', npm_config_ignore_scripts: 'false' } })
    const [pack] = JSON.parse(out)
    expect(pack.files.map((f) => f.path)).toContain('index.js')
    expect(hooksInstalled(folder)).toEqual([])
  })

  test('on a developer machine too, stdout stays pure JSON (the hooks message goes to stderr)', () => {
    const folder = freshCheckout()
    const out = execFileSync('npm', ['pack', '--dry-run', '--json'], { cwd: folder, encoding: 'utf8', env: { ...withoutCi(), npm_config_ignore_scripts: 'false' }, stdio: ['ignore', 'pipe', 'ignore'] })
    expect(JSON.parse(out)[0].name).toBe('resolve-browser-trace')
    expect(hooksInstalled(folder)).toEqual(expect.arrayContaining(['commit-msg', 'pre-commit']))
  })
})
