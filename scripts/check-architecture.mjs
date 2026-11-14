#!/usr/bin/env node
/**
 * Enforces the import rules described in ARCHITECTURE.md.
 *
 * Data flows one way:
 *   data/adapters -> domain -> features -> (app)
 *
 * So:
 *   - src/features/** must not import src/data/**   (UI stays format-agnostic)
 *   - src/features/** must not import src/app/**   (app composes features)
 *   - src/domain/**   must not import features or data  (the model is a leaf)
 *   - src/state/**    imports only domain  (shared interface state)
 *   - src/lib/**      must not import domain, state, features or data  (stays generic)
 *
 * Run: npm run check:arch
 */
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs'
import { join, relative } from 'node:path'

const RULES = [
  {
    dir: 'src/features',
    forbidden: [/(^|\/)data(\/|$)/, /^@\/data(\/|$)/],
    message: 'src/features/** must not import from src/data/**. Go through src/domain/ instead — this is what keeps the UI independent of external data formats.',
  },
  {
    dir: 'src/domain',
    forbidden: [/(^|\/)features(\/|$)/, /(^|\/)data(\/|$)/, /^@\/(features|data)(\/|$)/],
    message: 'src/domain/** must not import from src/features/** or src/data/**. The normalized model is a leaf — nothing above it may be pulled in.',
  },
  {
    dir: 'src/features',
    forbidden: [/(^|\/)app(\/|$)/, /^@\/app(\/|$)/],
    message: 'src/features/** must not import from src/app/**. The app shell composes features, not the other way round. Shared interface state lives in src/state/.',
  },
  {
    dir: 'src/state',
    forbidden: [/(^|\/)features(\/|$)/, /(^|\/)data(\/|$)/, /(^|\/)app(\/|$)/, /^@\/(features|data|app)(\/|$)/],
    message: 'src/state/** may import only src/domain/ (and libraries). Features and the app read state; state does not know about them.',
  },
  {
    dir: 'src/lib',
    forbidden: [/(^|\/)domain(\/|$)/, /(^|\/)state(\/|$)/, /(^|\/)features(\/|$)/, /(^|\/)data(\/|$)/, /^@\/(domain|state|features|data)(\/|$)/],
    message: 'src/lib/** must stay generic — no domain knowledge, and no src/state/ (it imports domain). Move anything Mars-specific into src/domain/ or the relevant feature.',
  },
]

const IMPORT_RE = /(?:import|export)[\s\S]*?from\s*['"]([^'"]+)['"]|import\s*\(\s*['"]([^'"]+)['"]\s*\)/g

function walk(dir) {
  if (!existsSync(dir)) return []
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) return walk(full)
    return /\.(ts|tsx|mts|cts)$/.test(name) ? [full] : []
  })
}

let violations = 0

for (const rule of RULES) {
  for (const file of walk(rule.dir)) {
    const src = readFileSync(file, 'utf8')
    for (const match of src.matchAll(IMPORT_RE)) {
      const spec = match[1] ?? match[2]
      if (!spec) continue
      if (rule.forbidden.some((re) => re.test(spec))) {
        const line = src.slice(0, match.index).split('\n').length
        const where = `${relative(process.cwd(), file)}:${line}`
        console.error(`\n✗ ${where}\n  imports "${spec}"\n  ${rule.message}`)
        violations++
      }
    }
  }
}

if (violations > 0) {
  console.error(`\n${violations} architecture violation(s). See ARCHITECTURE.md.\n`)
  process.exit(1)
}
console.log('✓ Architecture import rules respected.')
