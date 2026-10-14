#!/usr/bin/env node
// Records REAL error stacks from real browsers running the fixture bundles.
//
//   node scripts/capture-stacks.js chrome firefox edge webkit
//
// For every browser it serves test/fixtures/dist over http://localhost:<port>/, opens a page that loads each
// variant's bundle, runs every scenario (test/fixtures/src/app.tsx), and POSTs the `error.stack` strings back.
// The result is written to test/fixtures/stacks/<browser>.json together with the browser's user agent.
// Browsers are spawned with a throw-away profile (never the owner's), and are stopped by their recorded pid.
//
//   chrome / edge  headless Chromium (V8 stack format)
//   firefox        headless Firefox (SpiderMonkey / Gecko stack format)
//   node / bun     the same bundles run by the runtime itself in a vm context (test/fixtures/harness.js; single-file variants)
//   webkit         Playwright's WebKit build (JavaScriptCore / Safari stack format); needs `playwright` resolvable
//                  (e.g. NODE_PATH=<dir with `npm i playwright && npx playwright install webkit`>). Not a dependency.
//
// Safari.app itself is deliberately not driven: it would open tabs in the owner's own running browser.

const { execFileSync, spawn } = require('node:child_process')
const fs = require('node:fs')
const http = require('node:http')
const os = require('node:os')
const path = require('node:path')

const root = path.resolve(__dirname, '..')
const dist = path.join(root, 'test', 'fixtures', 'dist')
const outDir = path.join(root, 'test', 'fixtures', 'stacks')
const manifest = JSON.parse(fs.readFileSync(path.join(dist, 'manifest.json'), 'utf8'))
const PORT = 43817

const SCENARIOS = ['emptyCheckout', 'quoteNegative', 'bigDiscount', 'blankRow', 'rejectLater', 'lazyFailure']
const MODULE_VARIANTS = new Set(['bun-split', 'esbuild-split'])

// Page: loads one variant (?variant=...) and runs the scenarios.
function page(variant) {
  const entry = manifest[variant].bundles.find((f) => f.startsWith('app-') && !(variant === 'bun-split' && f === 'app-nfjt25qb.js'))
  const type = MODULE_VARIANTS.has(variant) ? ' type="module"' : ''
  return `<!doctype html><meta charset="utf-8"><title>${variant}</title>
<script>
window.__run = async function () {
  const stacks = {}
  for (const name of ${JSON.stringify(SCENARIOS)}) {
    try { await window.scenarios[name](); stacks[name] = null } catch (e) { stacks[name] = String(e && e.stack) }
  }
  await fetch('/report', { method: 'POST', body: JSON.stringify({ variant: ${JSON.stringify(variant)}, userAgent: navigator.userAgent, stacks }) })
}
</script>
<script${type} src="/${variant}/${entry}"></script>
<script>window.addEventListener('load', () => setTimeout(window.__run, 50))</script>`
}

function serve(onReport) {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost')
    if (req.method === 'POST' && url.pathname === '/report') {
      let body = ''
      req.on('data', (c) => (body += c))
      req.on('end', () => { res.end('ok'); onReport(JSON.parse(body)) })
      return
    }
    if (url.pathname === '/page') {
      res.setHeader('content-type', 'text/html')
      return res.end(page(url.searchParams.get('variant')))
    }
    const file = path.join(dist, path.normalize(url.pathname).replace(/^(\.\.[/\\])+/, ''))
    if (file.startsWith(dist) && fs.existsSync(file) && fs.statSync(file).isFile() && !file.endsWith('.map')) {
      res.setHeader('content-type', 'text/javascript')
      return res.end(fs.readFileSync(file))
    }
    res.statusCode = 404
    res.end()
  })
  return new Promise((resolve) => server.listen(PORT, '127.0.0.1', () => resolve(server)))
}

const binaries = {
  chrome: ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', (profile, url) => ['--headless=new', '--disable-gpu', '--no-first-run', `--user-data-dir=${profile}`, url]],
  edge: ['/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge', (profile, url) => ['--headless=new', '--disable-gpu', '--no-first-run', `--user-data-dir=${profile}`, url]],
  firefox: ['/Applications/Firefox.app/Contents/MacOS/firefox', (profile, url) => ['-headless', '-no-remote', '-profile', profile, url]],
}

// Resolves when the page for `variant` has POSTed its report (or rejects after 60 s).
let waiting = null
function nextReport() {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('no report from the browser within 60 s')), 60000)
    waiting = (report) => { clearTimeout(timer); resolve(report) }
  })
}

async function captureWith(browser, variant) {
  const url = `http://localhost:${PORT}/page?variant=${variant}`
  const reported = nextReport()
  if (browser === 'webkit') {
    const { webkit } = require('playwright')
    const b = await webkit.launch()
    try {
      const p = await b.newPage()
      await p.goto(url)
      return await reported
    } finally {
      await b.close()
    }
  }
  const [bin, args] = binaries[browser]
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), `rbt-${browser}-`))
  const child = spawn(bin, args(profile, url), { stdio: 'ignore' })
  try {
    return await reported
  } finally {
    child.kill('SIGTERM') // our own recorded child pid, nobody else's
    await new Promise((r) => setTimeout(r, 500))
    fs.rmSync(profile, { recursive: true, force: true })
  }
}

// node / bun: run the harness, no browser involved.
function captureRuntime(runtime) {
  const harness = path.join(root, 'test', 'fixtures', 'harness.js')
  const variants = {}
  for (const variant of ['bun', 'esbuild']) {
    variants[variant] = JSON.parse(execFileSync(runtime, [harness, variant], { encoding: 'utf8' }))
  }
  const version = execFileSync(runtime, ['--version'], { encoding: 'utf8' }).trim()
  fs.mkdirSync(outDir, { recursive: true })
  fs.writeFileSync(path.join(outDir, `${runtime}.json`), JSON.stringify({ browser: runtime, userAgent: `${runtime} ${version}`, origin: 'https://shop.example.com/assets', variants }, null, 2) + '\n')
  console.log(`${runtime} ${version}`)
}

async function main() {
  const browsers = process.argv.slice(2).filter((b) => (b === 'node' || b === 'bun' ? (captureRuntime(b), false) : true))
  const server = await serve((report) => waiting(report))
  for (const browser of browsers) {
    const results = {}
    for (const variant of Object.keys(manifest)) {
      results[variant] = await captureWith(browser, variant)
    }
    fs.mkdirSync(outDir, { recursive: true })
    const file = path.join(outDir, `${browser}.json`)
    const variants = Object.fromEntries(Object.entries(results).map(([v, r]) => [v, r.stacks]))
    const userAgent = Object.values(results)[0].userAgent
    fs.writeFileSync(file, JSON.stringify({ browser, userAgent, origin: `http://localhost:${PORT}`, variants }, null, 2) + '\n')
    console.log(`${browser}: ${userAgent}`)
  }
  server.close()
}

main().catch((e) => { console.error(e); process.exit(1) })
