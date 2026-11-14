#!/usr/bin/env node
/**
 * Builds the committed MEDA ground-temperature extract for Jezero.
 *
 * Source: PDS bundle `mars2020_meda` (doi 10.17189/1522849), collection
 * `data_calibrated_env`, one `CAL_TIRS` product per sol. Its GROUND_TEMP
 * column is the "TIRS Ground brightness temperature" in kelvin, with a
 * per-sample standard deviation and the rover's quality flags. (The
 * derived collection's DER_TIRS product holds only irradiances,
 * not this temperature.)
 *
 * For every sol the script downloads the product (about 5.5 MB), keeps the
 * samples the flags allow (the wheel flag is blank where the archive does
 * not fill it, and a blank is kept), and writes one summary row: sol, the Earth
 * date at local mean noon, Ls, the minimum and maximum ground temperature
 * with their uncertainties and local true solar times, and which hours of
 * the sol the kept samples fall in. Ls is OFFICIAL too: the product label's
 * own `mars2020:start_solar_longitude`. (The DER_ANCILLARY column named
 * SOLAR_LONGITUDE_ANGLE is a per-second Sun angle, not Ls: the first run
 * read it, and `--write-only` refuses a summary still carrying it.)
 *
 * About 9.6 GB crosses the network once; nothing of it is kept. Each sol's
 * summary is cached as JSON, so a stopped run resumes where it was.
 *
 * Run:  node scripts/build-meda-extract.mjs --cache <dir> [--workers 4]
 *                                            [--sols 1800-1859] [--write-only]
 * Out:  src/data/temperature/medaJezeroGroundTemperature.ts, typed `unknown`:
 *       `medaJezero.ts` validates it before anything reads a number
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const BUNDLE = 'https://atmos.nmsu.edu/PDS/data/PDS4/Mars2020/mars2020_meda'
const CALIBRATED = `${BUNDLE}/data_calibrated_env`
const INVENTORY = `${CALIBRATED}/collection_meda_data_calibrated_env_inventory.csv`
const OUT = 'src/data/temperature/medaJezeroGroundTemperature.ts'
const DOI = '10.17189/1522849'
/** Marks a summary whose Ls is the label's; older summaries are relabelled. */
const LS_FROM = 'label:start_solar_longitude'
/** Earth hours per Mars hour (a sol is 24 h 39 m 35.244 s). */
const EARTH_HOURS_PER_MARS_HOUR = 1.0274912517

const args = parseArgs(process.argv.slice(2))
if (!args.cache) fail('--cache <dir> is required (the per-sol summaries live there)')
const workers = Number(args.workers ?? 4)
mkdirSync(args.cache, { recursive: true })

const sols = await listSols()
const wanted = args.sols ? sols.filter(inRange(args.sols)) : sols
console.log(`${sols.length} CAL_TIRS products in the inventory; building ${wanted.length}`)

if (!args['write-only']) {
  const folders = await listRangeFolders()
  const queue = wanted.filter((sol) => !existsSync(summaryPath(sol)))
  // Summaries from before Ls came from the label get only the label again.
  const relabel = wanted.filter((sol) => existsSync(summaryPath(sol)) && readSummary(sol).lsFrom !== LS_FROM)
  console.log(
    `${wanted.length - queue.length} cached (${relabel.length} to relabel), ${queue.length} to fetch with ${workers} workers`,
  )
  queue.unshift(...relabel)
  let done = 0
  const failures = []
  await Promise.all(
    Array.from({ length: workers }, async () => {
      for (let sol = queue.shift(); sol !== undefined; sol = queue.shift()) {
        try {
          const summary = existsSync(summaryPath(sol))
            ? await withRetries(() => relabelSol(sol, folders), 3)
            : await withRetries(() => summariseSol(sol, folders), 3)
          writeFileSync(summaryPath(sol), JSON.stringify(summary))
        } catch (error) {
          failures.push(sol)
          console.error(`✗ sol ${sol}: ${error.message}`)
        }
        done += 1
        if (done % 25 === 0 || done === queue.length) console.log(`  ${done} fetched`)
      }
    }),
  )
  if (failures.length > 0) fail(`${failures.length} sols failed: ${failures.join(' ')}. Run again to retry them.`)
}

writeExtract(wanted)

// ---------------------------------------------------------------- per sol

async function locateProduct(sol, folders) {
  const folder = folders.find((f) => sol >= f.from && sol <= f.to)
  if (!folder) throw new Error('no range folder lists this sol')
  const calDir = `${CALIBRATED}/${folder.name}/sol_${pad(sol)}/`
  const calFiles = await listFiles(calDir)
  const csvName = calFiles.find((f) => /_CAL_TIRS_+P\d+\.CSV$/.test(f))
  const xmlName = calFiles.find((f) => /_CAL_TIRS_+P\d+\.xml$/.test(f))
  if (!csvName || !xmlName) throw new Error('CAL_TIRS product not listed')
  return { csvUrl: calDir + csvName, xmlUrl: calDir + xmlName }
}

/** Ls at the product's start, from its label; the mission dictionary's own field. */
function labelLs(xml) {
  const ls = Number(xml.match(/<mars2020:start_solar_longitude[^>]*>([^<]+)</)?.[1])
  if (!Number.isFinite(ls) || ls < 0 || ls > 360) throw new Error('label has no start_solar_longitude')
  return round(ls, 2)
}

async function relabelSol(sol, folders) {
  const { xmlUrl } = await locateProduct(sol, folders)
  const xml = await fetchText(xmlUrl)
  return { ...readSummary(sol), solarLongitudeDeg: labelLs(xml), lsFrom: LS_FROM }
}

async function summariseSol(sol, folders) {
  const { csvUrl, xmlUrl } = await locateProduct(sol, folders)
  const [csv, xml] = await Promise.all([fetchText(csvUrl), fetchText(xmlUrl)])

  const table = parseCsv(csv)
  const col = (name) => {
    const i = table.header.indexOf(name)
    if (i < 0) throw new Error(`column ${name} missing`)
    return i
  }
  const iTemp = col('GROUND_TEMP')
  const iUnc = col('GROUND_TEMP_UNCERTAINTY')
  const iLtst = col('LTST')
  const iLmst = col('LMST')
  const iShadow = col('TIRS_GROUND_FOOTPRINT_NOT_IN_SHADOW')
  const iTilt = col('ROVER_LOW_TILT')
  const iWheel = col('WHEEL_OUTSIDE_TIRS_DOWNWARD_LOOKING_FOV')
  const unit = xml.match(/<name>GROUND_TEMP<\/name>[\s\S]*?<unit>([^<]+)<\/unit>/)?.[1]
  if (unit !== 'kelvin') throw new Error(`GROUND_TEMP unit is ${unit ?? 'missing'}, not kelvin`)
  const version = xml.match(/<version_id>([^<]+)<\/version_id>/)?.[1] ?? null
  const start = xml.match(/<start_date_time>([^<]+)<\/start_date_time>/)?.[1]
  if (!start) throw new Error('label has no start_date_time')

  let min = null
  let max = null
  let hoursMask = 0
  let kept = 0
  for (const row of table.rows) {
    if (row[iShadow] !== '1' || row[iTilt] !== '1' || row[iWheel] === '0') continue
    const temperatureK = Number(row[iTemp])
    const uncertaintyK = Number(row[iUnc])
    const ltst = ltstHours(row[iLtst])
    if (!Number.isFinite(temperatureK) || !Number.isFinite(uncertaintyK) || ltst === null) continue
    kept += 1
    hoursMask |= 1 << Math.floor(ltst)
    // Two decimals, and 23:59:50 stays inside the sol rather than rounding to 24.
    const sample = { temperatureK, uncertaintyK, localTrueSolarHours: Math.min(round(ltst, 2), 23.99) }
    if (min === null || temperatureK < min.temperatureK) min = sample
    if (max === null || temperatureK > max.temperatureK) max = sample
  }

  return {
    sol,
    dateUtc: noonDate(start, table.rows[0]?.[iLmst]),
    solarLongitudeDeg: labelLs(xml),
    lsFrom: LS_FROM,
    min,
    max,
    hoursMask,
    samplesKept: kept,
    samplesTotal: table.rows.length,
    productVersion: version,
  }
}

/** The UTC date at the sol's local mean noon: the product's start instant moved from its LMST to 12:00. */
function noonDate(startIso, firstLmst) {
  const lmst = firstLmst?.match(/M(\d\d):(\d\d):(\d\d(?:\.\d+)?)$/)
  if (!lmst) throw new Error(`cannot read LMST "${firstLmst}"`)
  const lmstHours = Number(lmst[1]) + Number(lmst[2]) / 60 + Number(lmst[3]) / 3600
  const ms = Date.parse(startIso) + (12 - lmstHours) * EARTH_HOURS_PER_MARS_HOUR * 3_600_000
  return new Date(ms).toISOString().slice(0, 10)
}

/** "1859 13:57:24" → 13.956…; null when the field is blank. */
function ltstHours(field) {
  const m = field?.match(/(\d\d):(\d\d):(\d\d)$/)
  return m ? Number(m[1]) + Number(m[2]) / 60 + Number(m[3]) / 3600 : null
}

// ---------------------------------------------------------------- output

function writeExtract(wanted) {
  const rows = []
  const missing = []
  for (const sol of wanted) {
    if (!existsSync(summaryPath(sol))) {
      missing.push(sol)
      continue
    }
    const s = readSummary(sol)
    if (s.lsFrom !== LS_FROM) fail(`sol ${sol}: Ls is not from the label yet; run without --write-only first`)
    rows.push([
      s.sol,
      s.dateUtc,
      s.solarLongitudeDeg,
      s.min?.temperatureK ?? null,
      s.min?.uncertaintyK ?? null,
      s.min?.localTrueSolarHours ?? null,
      s.max?.temperatureK ?? null,
      s.max?.uncertaintyK ?? null,
      s.max?.localTrueSolarHours ?? null,
      s.hoursMask,
      s.samplesKept,
      s.samplesTotal,
    ])
  }
  if (missing.length > 0) fail(`${missing.length} sols have no summary yet: ${missing.slice(0, 10).join(' ')}…`)
  rows.sort((a, b) => a[0] - b[0])
  const extract = {
    provenance: {
      bundle: `${BUNDLE}/`,
      doi: DOI,
      collection: 'data_calibrated_env',
      product: 'CAL_TIRS (Mars 2020 MEDA Thermal Infrared Sensor Calibrated Data)',
      column: 'GROUND_TEMP — "TIRS Ground brightness temperature", kelvin; GROUND_TEMP_UNCERTAINTY, its standard deviation',
      solarLongitude: 'The product label’s mars2020:start_solar_longitude, degrees: Ls at the product’s first sample',
      samplesKept:
        'TIRS_GROUND_FOOTPRINT_NOT_IN_SHADOW = 1, ROVER_LOW_TILT = 1 and WHEEL_OUTSIDE_TIRS_DOWNWARD_LOOKING_FOV ≠ 0 (blank where the archive does not fill it; a blank is kept), as the product labels define them',
      dateUtc: 'The UTC date at the sol’s local mean noon (LMST 12:00), from the product’s start_date_time and first LMST',
      hoursMask: 'Bit h (0–23) is set when a kept sample falls in local true solar hour h; which hours the minimum and maximum could have been seen in',
      builtWith: 'scripts/build-meda-extract.mjs',
      builtOn: new Date().toISOString().slice(0, 10),
      solRange: [rows[0][0], rows[rows.length - 1][0]],
      sols: rows.length,
    },
    columns: [
      'sol',
      'dateUtc',
      'solarLongitudeDeg',
      'minK',
      'minUncertaintyK',
      'minLocalTrueSolarHours',
      'maxK',
      'maxUncertaintyK',
      'maxLocalTrueSolarHours',
      'hoursMask',
      'samplesKept',
      'samplesTotal',
    ],
    rows,
  }
  mkdirSync(join(OUT, '..'), { recursive: true })
  const json = JSON.stringify(extract, null, 0).replace(/\],\[/g, '],\n[')
  writeFileSync(
    OUT,
    `// Generated by scripts/build-meda-extract.mjs on ${extract.provenance.builtOn}. Do not edit: run the script.\n` +
      `// OFFICIAL: Mars 2020 MEDA calibrated TIRS ground temperature per sol, PDS doi ${DOI} (see \`provenance\`).\n` +
      `// Typed unknown on purpose: medaJezero.ts validates every row before a number leaves this file.\n` +
      `export const MEDA_JEZERO_RAW: unknown = ${json}\n`,
  )
  const full = rows.filter((r) => r[9] === 0xffffff).length
  console.log(`✓ ${OUT}: ${rows.length} sols (${rows[0][0]}–${rows[rows.length - 1][0]}), ${full} with every hour sampled`)
}

// ---------------------------------------------------------------- listings

async function listSols() {
  const text = await fetchText(INVENTORY)
  const sols = []
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/:we__(\d{4})_+cal_tirs_+p::/)
    if (m) sols.push(Number(m[1]))
  }
  if (sols.length === 0) throw new Error('inventory lists no CAL_TIRS products')
  return sols.sort((a, b) => a - b)
}

async function listRangeFolders() {
  const html = await fetchText(`${CALIBRATED}/`)
  return [...html.matchAll(/href="(sol_(\d{4})_(\d{4}))\/"/g)].map((m) => ({
    name: m[1],
    from: Number(m[2]),
    to: Number(m[3]),
  }))
}

async function listFiles(dirUrl) {
  const html = await fetchText(dirUrl)
  return [...html.matchAll(/href="([^"/?]+)"/g)].map((m) => m[1])
}

// ---------------------------------------------------------------- helpers

async function fetchText(url, headers = {}) {
  const response = await fetch(url, { headers, signal: AbortSignal.timeout(180_000) })
  if (!response.ok) throw new Error(`${response.status} for ${url}`)
  return response.text()
}

async function withRetries(task, times) {
  let last
  for (let i = 0; i < times; i++) {
    try {
      return await task()
    } catch (error) {
      last = error
    }
  }
  throw last
}

function parseCsv(text) {
  const lines = text.split(/\r?\n/).filter((l) => l.length > 0)
  return { header: lines[0].split(','), rows: lines.slice(1).map((l) => l.split(',')) }
}

function summaryPath(sol) {
  return join(args.cache, `sol_${pad(sol)}.json`)
}

function readSummary(sol) {
  return JSON.parse(readFileSync(summaryPath(sol), 'utf8'))
}

function inRange(spec) {
  const [from, to = from] = spec.split('-').map(Number)
  return (sol) => sol >= from && sol <= to
}

function parseArgs(argv) {
  const out = {}
  for (let i = 0; i < argv.length; i++) {
    if (!argv[i].startsWith('--')) continue
    const key = argv[i].slice(2)
    const next = argv[i + 1]
    if (next === undefined || next.startsWith('--')) out[key] = true
    else out[key] = argv[++i]
  }
  return out
}

function pad(sol) {
  return String(sol).padStart(4, '0')
}
function round(x, d) {
  return Number(x.toFixed(d))
}
function fail(message) {
  console.error(`✗ ${message}`)
  process.exit(1)
}
