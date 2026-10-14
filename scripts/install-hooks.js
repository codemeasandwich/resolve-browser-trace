#!/usr/bin/env node
// `npm install` runs this (via "prepare"): copies .hooks/* into the repository's git hooks folder.
// Works in plain clones and in git worktrees (it asks git where hooks live). Does nothing, quietly, when there is
// no git repository (for example when the package is installed from a tarball) or no .hooks folder.

const { execFileSync } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '..')
const source = path.join(root, '.hooks')

function hooksTarget() {
  try {
    return path.resolve(root, execFileSync('git', ['rev-parse', '--git-path', 'hooks'], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim())
  } catch {
    return null
  }
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
  const kept = files.filter((file) => fs.lstatSync(path.join(to, file), { throwIfNoEntry: false }))
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
    return execFileSync('git', ['config', '--get', 'core.hooksPath'], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim() !== ''
  } catch {
    return false
  }
}

const target = hooksTarget()
if (target && sharedHooksPath()) {
  // core.hooksPath often points at a folder shared by many repositories: never overwrite hooks there
  console.log('resolve-browser-trace: core.hooksPath is set, git hooks not installed (copy .hooks/* yourself if wanted)')
} else if (target && fs.existsSync(source)) {
  try {
    const { installed, kept } = installHooks(source, target)
    console.log(
      kept.length > 0
        ? `resolve-browser-trace: git hooks not installed: you already have ${kept.join(', ')} in ${target}`
        : `resolve-browser-trace: git hooks installed in ${target}: ${installed.join(', ')}`
    )
  } catch (error) {
    // a hooks folder that cannot be written must not make `npm install` fail
    console.log(`resolve-browser-trace: git hooks not installed (${error.message})`)
  }
}
