#!/usr/bin/env node
/**
 * Keeps Three.js out of the first load.
 *
 * The globe and the surface view are lazy chunks. One static import of a
 * module that pulls in `three` from the shell or mission-ui would put the
 * whole of it back in the first load, and nothing else would fail. So,
 * after `vite build`:
 *   - the files the page loads up front (the entry script, its modulepreload
 *     links and every chunk they import statically) must not contain
 *     Three.js, recognised by its `WebGLRenderer` class;
 *   - those files together must stay under 500 kB, the first-load target. The
 *     bundler can move a library into a preloaded shared chunk while the
 *     entry stays small, so the entry alone is not enough.
 *
 * Assumes Vite's defaults: `base: '/'` and chunks under `assets/`. Another
 * layout fails with a ✗ line naming the file; it never passes silently.
 *
 * Run: npm run build && npm run check:bundle
 */
import { existsSync, readFileSync, statSync } from 'node:fs'
import { join, posix } from 'node:path'

const DIST = 'dist'
const THREE_MARKER = 'WebGLRenderer'
const FIRST_LOAD_LIMIT_KB = 500

const html = join(DIST, 'index.html')
if (!existsSync(html)) {
  console.error(`✗ ${html} not found. Run npm run build first.`)
  process.exit(1)
}
const page = readFileSync(html, 'utf8')

const entry = page.match(/<script[^>]*type="module"[^>]*src="\/([^"]+\.js)"/)?.[1]
if (!entry) {
  console.error(`✗ No module script in ${html}; the check cannot find the entry chunk.`)
  process.exit(1)
}
const preloads = [...page.matchAll(/<link[^>]*rel="modulepreload"[^>]*href="\/([^"]+\.js)"/g)].map((m) => m[1])

// Static imports only: `from"./x.js"`, `import"../x.js"`. A dynamic
// `import(...)` has a parenthesis and is the lazy split itself.
const STATIC_IMPORT_RE = /(?:from|import)\s*["'](\.\.?\/[^"']+\.js)["']/g

let failures = 0
const firstLoad = new Set()
const queue = [entry, ...preloads]
while (queue.length > 0) {
  const file = queue.pop()
  if (firstLoad.has(file)) continue
  firstLoad.add(file)
  if (!existsSync(join(DIST, file))) {
    console.error(`\n✗ ${file} is referenced by the first load but is not in ${DIST}/.`)
    failures++
    continue
  }
  for (const m of readFileSync(join(DIST, file), 'utf8').matchAll(STATIC_IMPORT_RE)) {
    queue.push(posix.join(posix.dirname(file), m[1]))
  }
}
const found = [...firstLoad].filter((file) => existsSync(join(DIST, file))).sort()

for (const file of found) {
  if (readFileSync(join(DIST, file), 'utf8').includes(THREE_MARKER)) {
    console.error(
      `\n✗ ${file} is loaded up front and contains the Three.js renderer.\n` +
        '  Something the shell or mission-ui imports statically now uses three or\n' +
        '  @react-three/* (an unused import is tree-shaken and does not count).\n' +
        '  Load that component with React.lazy, or move the Three-free part out of\n' +
        '  the module that uses Three.',
    )
    failures++
  }
}

const kb = (file) => statSync(join(DIST, file)).size / 1000
const entryKb = found.includes(entry) ? kb(entry) : 0
const totalKb = found.reduce((sum, file) => sum + kb(file), 0)
if (totalKb > FIRST_LOAD_LIMIT_KB) {
  console.error(
    `\n✗ The first load is ${totalKb.toFixed(1)} kB (entry ${entryKb.toFixed(1)} kB), ` +
      `over the ${FIRST_LOAD_LIMIT_KB} kB target:\n` +
      found.map((file) => `    ${file}  ${kb(file).toFixed(1)} kB`).join('\n'),
  )
  failures++
}

if (failures > 0) {
  console.error(`\n${failures} bundle check(s) failed.\n`)
  process.exit(1)
}
console.log(
  `✓ First load is Three-free: ${found.join(', ')}; ${totalKb.toFixed(1)} kB in all, entry ${entryKb.toFixed(1)} kB.`,
)
