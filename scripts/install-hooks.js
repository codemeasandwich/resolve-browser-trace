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

// every file copied from .hooks is a script git must be allowed to run
function makeExecutable(from, to) {
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    const copied = path.join(to, entry.name)
    if (entry.isDirectory()) {
      makeExecutable(path.join(from, entry.name), copied)
    } else {
      fs.chmodSync(copied, 0o755)
    }
  }
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
  fs.mkdirSync(target, { recursive: true })
  fs.cpSync(source, target, { recursive: true, force: false, errorOnExist: false }) // hooks already there are kept
  makeExecutable(source, target)
  console.log(`resolve-browser-trace: git hooks installed in ${target}`)
}
