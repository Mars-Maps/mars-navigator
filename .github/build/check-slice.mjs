#!/usr/bin/env node
/**
 * Guards the build-up of the project: every tracked file must be a file the
 * project manifest knows, with exactly the expected content, and one pull
 * request adds one part of the project, after the parts it depends on.
 *
 * Run: node .github/build/check-slice.mjs [base-commit]
 */
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

const manifest = JSON.parse(readFileSync(new URL('./manifest.json', import.meta.url), 'utf8'))
const SELF = '.github/build/manifest.json'
const git = (...args) => execFileSync('git', args, { encoding: 'utf8', maxBuffer: 1 << 26 })

const tree = new Map()
for (const line of git('ls-tree', '-r', 'HEAD').split('\n').filter(Boolean)) {
  const [meta, path] = line.split('\t')
  tree.set(path, meta.split(' ')[2])
}

const errors = []
for (const [path, blob] of tree) {
  if (path === SELF) continue
  const known = manifest.files[path]
  if (known?.blob === blob || manifest.extras[path] === blob) continue
  errors.push(known || manifest.extras[path]
    ? `${path}: content differs from the expected file (was it edited or reformatted?)`
    : `${path}: not a file this project expects`)
}

const base = process.argv[2]
if (base && !/^0*$/.test(base)) {
  const changed = git('diff', '--name-only', `${base}...HEAD`).split('\n').filter(Boolean)
  const parts = new Set(changed.map((p) => manifest.files[p]?.slice ?? 's0'))
  if (parts.size > 1) errors.push(`one pull request, one part of the project; this one touches ${[...parts].join(', ')}`)
  for (const part of parts) {
    for (const need of manifest.slices[part] ?? []) {
      const missing = Object.entries(manifest.files).filter(([p, f]) => f.slice === need && !tree.has(p))
      if (missing.length) errors.push(`${part} needs ${need} merged first (${missing.length} files missing)`)
    }
  }
}

if (errors.length) {
  console.error(errors.map((e) => `✗ ${e}`).join('\n'))
  process.exit(1)
}
console.log(`✓ ${tree.size} files match the project manifest.`)
