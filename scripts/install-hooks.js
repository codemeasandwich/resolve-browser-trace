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

const target = hooksTarget()
if (target && fs.existsSync(source)) {
  fs.mkdirSync(target, { recursive: true })
  fs.cpSync(source, target, { recursive: true })
  for (const file of fs.readdirSync(target, { recursive: true })) {
    const full = path.join(target, file)
    if (fs.statSync(full).isFile() && !full.endsWith('.js')) {
      fs.chmodSync(full, 0o755)
    }
  }
  console.log(`resolve-browser-trace: git hooks installed in ${target}`)
}
