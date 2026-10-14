'use strict'

const { execFileSync, spawnSync } = require('node:child_process')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { PROJECT_ROOT } = require('./helpers')

// "The owner runs npm run release." scripts/publish.sh is run in a scratch repository with a bare "origin" and with
// stand-ins for npm and gh on the PATH, so nothing is published, pushed anywhere real, or released.

function scratch({ ci = '1', npmView = '0.10.1', hookFails = false } = {}) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'rbt-release-'))
  const origin = path.join(base, 'origin.git')
  const work = path.join(base, 'work')
  const bin = path.join(base, 'bin')
  fs.mkdirSync(bin)
  execFileSync('git', ['init', '-q', '--bare', '-b', 'master', origin])
  execFileSync('git', ['init', '-q', '-b', 'master', work])
  const git = (...args) => execFileSync('git', args, { cwd: work, encoding: 'utf8' })
  git('config', 'user.email', 'test@example.com')
  git('config', 'user.name', 'Test')
  git('remote', 'add', 'origin', origin)
  fs.writeFileSync(path.join(work, 'package.json'), JSON.stringify({ name: 'demo', version: '1.0.0' }, null, 2) + '\n')
  fs.mkdirSync(path.join(work, 'scripts'))
  fs.copyFileSync(path.join(PROJECT_ROOT, 'scripts', 'publish.sh'), path.join(work, 'scripts', 'publish.sh'))
  git('add', '-A')
  git('commit', '-q', '-m', 'feat: first')
  git('push', '-q', 'origin', 'master')
  // npm: `test` passes, `view` answers, `version` rewrites package.json like the real one
  fs.writeFileSync(
    path.join(bin, 'npm'),
    `#!/bin/sh
case "$1" in
  test) exit 0 ;;
  view) echo "${npmView}" ;;
  version) node -e "const f='package.json',p=require('./'+f);p.version=process.argv[1];require('fs').writeFileSync(f,JSON.stringify(p,null,2)+'\\n')" "$2" ;;
esac
`
  )
  fs.writeFileSync(
    path.join(bin, 'gh'),
    `#!/bin/sh
case "$1 $2" in
  "run list") echo ${ci} ;;
  "release create") cat > "${path.join(base, 'release-notes.txt')}"; echo "$3" > "${path.join(base, 'release-tag.txt')}" ;;
esac
`
  )
  fs.chmodSync(path.join(bin, 'npm'), 0o755)
  fs.chmodSync(path.join(bin, 'gh'), 0o755)
  if (hookFails) {
    fs.writeFileSync(path.join(work, '.git', 'hooks', 'pre-commit'), '#!/bin/sh\nexit 1\n', { mode: 0o755 })
  }
  const run = (...args) =>
    spawnSync('bash', ['scripts/publish.sh', ...args], { cwd: work, encoding: 'utf8', env: { ...process.env, PATH: `${bin}:${process.env.PATH}` } })
  return { run, git, work, base }
}

describe('npm run release (scripts/publish.sh), with npm and gh stood in', () => {
  test('releases the version in package.json when it is higher than npm, after the checks, targeting HEAD', () => {
    const { run, base, git } = scratch()
    const result = run()
    expect(result.status).toBe(0)
    expect(result.stdout).toMatch(/Release v1\.0\.0 created/)
    expect(fs.readFileSync(path.join(base, 'release-tag.txt'), 'utf8')).toMatch(/^v1\.0\.0/)
    expect(git('status', '--porcelain')).toBe('')
  })

  test.each([
    ['a version with a leading zero', ['1.08.0']],
    ['a pre-release', ['1.0.0-rc.1']],
    ['text', ['latest']],
  ])('%s as the argument is refused before anything happens', (_, args) => {
    const { run } = scratch()
    const result = run(...args)
    expect(result.status).toBe(1)
    expect(result.stderr).toMatch(/invalid version/)
  })

  test('refuses when HEAD is not what origin has', () => {
    const { run, git, work } = scratch()
    fs.writeFileSync(path.join(work, 'later.txt'), 'x')
    git('add', '-A')
    git('commit', '-q', '-m', 'feat: not pushed')
    const result = run()
    expect(result.status).toBe(1)
    expect(result.stderr).toMatch(/not the same commit as origin/)
  })

  test('refuses when CI has not passed for HEAD', () => {
    const { run } = scratch({ ci: '0' })
    const result = run()
    expect(result.status).toBe(1)
    expect(result.stderr).toMatch(/no passing CI run/)
  })

  test('refuses when the version is not higher than the one on npm', () => {
    const { run } = scratch({ npmView: '1.0.0' })
    expect(run('1.0.0').stderr).toMatch(/must be higher than the npm version/)
    expect(run().status).toBe(0) // without an argument it bumps from the commits instead
  })

  test('refuses off main and master, and with uncommitted changes', () => {
    const { run, git, work } = scratch()
    fs.writeFileSync(path.join(work, 'dirty.txt'), 'x')
    expect(run().stderr).toMatch(/uncommitted changes/)
    fs.rmSync(path.join(work, 'dirty.txt'))
    git('checkout', '-q', '-b', 'feature')
    expect(run().stderr).toMatch(/release from main or master/)
  })

  test('when the version commit fails (a failing hook) package.json is put back and the tree is clean', () => {
    const { run, git, work } = scratch({ hookFails: true, npmView: '0.10.1' })
    const result = run('1.1.0')
    expect(result.status).not.toBe(0)
    expect(JSON.parse(fs.readFileSync(path.join(work, 'package.json'), 'utf8')).version).toBe('1.0.0')
    expect(git('status', '--porcelain')).toBe('')
  })
})
