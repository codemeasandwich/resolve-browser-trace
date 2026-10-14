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

// Copies the hook files that are not there yet (a hook the developer already has is kept) and makes them executable.
function installHooks(from, to, installed = [], kept = []) {
  fs.mkdirSync(to, { recursive: true })
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    const copied = path.join(to, entry.name)
    if (entry.isDirectory()) {
      installHooks(path.join(from, entry.name), copied, installed, kept)
    } else if (fs.lstatSync(copied, { throwIfNoEntry: false })) {
      kept.push(entry.name)
    } else {
      fs.copyFileSync(path.join(from, entry.name), copied)
      fs.chmodSync(copied, 0o755)
      installed.push(entry.name)
    }
  }
  return { installed, kept }
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
    console.log(`resolve-browser-trace: git hooks installed in ${target}: ${installed.join(', ') || 'none'}${kept.length ? `; kept your existing ${kept.join(', ')}` : ''}`)
  } catch (error) {
    // a hooks folder that cannot be written must not make `npm install` fail
    console.log(`resolve-browser-trace: git hooks not installed (${error.message})`)
  }
}
