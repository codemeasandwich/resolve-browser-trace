#!/usr/bin/env node
// `npm install` runs this (via "prepare"): copies .hooks/* into the repository's git hooks folder.
// Works in plain clones and in git worktrees (it asks git where hooks live).
// It does nothing at all, and says nothing, when
//   - CI is set (a build machine has no use for commit hooks),
//   - this folder is not the top of its own git checkout (a tarball or a git dependency unpacked inside somebody
//     else's repository must never touch that repository's hooks), or
//   - there is no .hooks folder.
// Its messages go to stderr: `npm pack --json` runs `prepare` on some npm versions and reads stdout as JSON.

const { execFileSync } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '..')
const source = path.join(root, '.hooks')

function git(...args) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
}

// The hooks folder of the checkout this script lives in, or null when it is not the top of a git checkout.
function hooksTarget() {
  try {
    if (fs.realpathSync(git('rev-parse', '--show-toplevel')) !== fs.realpathSync(root)) {
      return null
    }
    return path.resolve(root, git('rev-parse', '--git-path', 'hooks'))
  } catch {
    return null
  }
}

function sameFile(a, b) {
  return fs.lstatSync(b).isFile() && fs.readFileSync(a).equals(fs.readFileSync(b))
}

// The files under .hooks, as paths relative to it.
function hookFiles(dir, prefix = '') {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? hookFiles(path.join(dir, entry.name), `${prefix}${entry.name}/`) : [`${prefix}${entry.name}`]
  )
}

// All or none: if the developer already has any of these hooks, none is installed (half a set of checks, for
// example a commit-msg rule without the coverage check that goes with it, would be worse than neither).
function installHooks(from, to) {
  const files = hookFiles(from)
  const existing = files.filter((file) => fs.lstatSync(path.join(to, file), { throwIfNoEntry: false }))
  // a file identical to ours was put there by an earlier run of this script
  const kept = existing.filter((file) => !sameFile(path.join(from, file), path.join(to, file)))
  if (kept.length === 0 && existing.length === files.length) {
    return { installed: [], kept, upToDate: true }
  }
  if (kept.length > 0) {
    return { installed: [], kept }
  }
  for (const file of files) {
    fs.mkdirSync(path.dirname(path.join(to, file)), { recursive: true })
    fs.copyFileSync(path.join(from, file), path.join(to, file))
    fs.chmodSync(path.join(to, file), 0o755)
  }
  return { installed: files, kept }
}

function sharedHooksPath() {
  try {
    return git('config', '--get', 'core.hooksPath') !== ''
  } catch {
    return false
  }
}

const target = process.env.CI ? null : hooksTarget()
if (target && sharedHooksPath()) {
  // core.hooksPath often points at a folder shared by many repositories: never overwrite hooks there
  console.error('resolve-browser-trace: core.hooksPath is set, git hooks not installed (copy .hooks/* yourself if wanted)')
} else if (target && fs.existsSync(source)) {
  try {
    const { installed, kept, upToDate } = installHooks(source, target)
    if (upToDate) {
      console.error('resolve-browser-trace: git hooks up to date')
    } else {
      console.error(
        kept.length > 0
          ? `resolve-browser-trace: git hooks not installed: you already have ${kept.join(', ')} in ${target}`
          : `resolve-browser-trace: git hooks installed in ${target}: ${installed.join(', ')}`
      )
    }
  } catch (error) {
    // a hooks folder that cannot be written must not make `npm install` fail
    console.error(`resolve-browser-trace: git hooks not installed (${error.message})`)
  }
}
