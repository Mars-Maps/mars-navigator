import { describe, expect, it } from 'vitest'
import { coversHours, parseMedaExtract, type MedaSample, type MedaSolRecord } from '../../src/data/temperature/medaJezero'
import { MEDA_JEZERO_RAW } from '../../src/data/temperature/medaJezeroGroundTemperature'
import { MEDA_EXTREME_HOURS } from '../../src/data/temperature/measuredTemperature'
import { parseRemsFeed } from '../../src/data/temperature/remsGaleFeed'
import { JEZERO } from '../../src/data/sites/sites'
import { CELSIUS_OFFSET_K, isAvailable, type MarsCoordinate, type SurfaceThermalProperties } from '../../src/domain'
import { mars24Steps } from '../../src/domain/mars24'
import { VALIDATED_ERROR } from '../../src/features/route-analysis/temperatureModel'
import { co2FrostPointK, curveExtremes, diurnalCurve, surfacePressurePa } from '../../src/features/route-analysis/thermalModel'
import { readCommittedTesGrids } from '../fixtures/committedTesGrids'
import { REMS_GALE_SAMPLE_PROVENANCE, REMS_GALE_SAMPLED_RAW } from '../fixtures/remsGaleSampled'

/**
 * The model against the two rovers' ground temperatures (Jezero,
 * then Gale, and the one bound for both): the sol's modelled minimum
 * and maximum at each site, on the official TES grids' cell there,
 * for the season of each sampled sol, against the sol's measured
 * extremes.
 *
 * Jezero: Perseverance MEDA TIRS, every tenth sol whose samples cover the
 * cold and warm hours, so the measured extremes are the sol's own. The dust
 * and sky choices were fitted on this comparison, so it is not independent.
 * Gale: Curiosity REMS GTS, the committed sample of every 20th sol of the
 * outreach feed, integer °C per sol with no times, so sol
 * extremes against sol extremes. Nothing was fitted on Gale: it is the
 * independent check.
 *
 * The recorded error is one bound for both sites: the larger root-mean-
 * square difference over minimum and maximum together, rounded up to a
 * kelvin. The test fails if either site drifts past it, and the method text
 * the UI shows must describe each site's run.
 */

/** Perseverance's height on the Jezero floor, metres: the point menu's read at the landing site (read 2026-10-30). */
const JEZERO_FLOOR_ELEVATION_M = -2569
const EVERY_NTH_MEDA_SOL = 10

/**
 * Bradbury Landing, Curiosity's landing site: 4.5895°S, 137.4417°E at
 * −4501 m (Vasavada et al., 2014, Overview of the Mars Science Laboratory
 * mission, J. Geophys. Res. Planets 119, 1134–1161, doi
 * 10.1002/2014JE004622). The rover's whole traverse so far lies inside the
 * one 0.5° global TES cell this point falls in (137.0–137.5°E, 4.5–5.0°S),
 * so the cell stands for every sol. The rover has since climbed some
 * hundreds of metres; the pressure sets only the CO2 frost floor of the
 * curve, which the test checks stays far below the coldest Gale
 * measurement, so the height cannot move a result.
 */
const GALE_LANDING: MarsCoordinate = { latitude: -4.5895, longitudeEast: 137.4417 }
const GALE_LANDING_ELEVATION_M = -4501

interface Stats {
  n: number
  meanK: number
  rmsK: number
  worstK: number
}

function stats(errors: readonly number[]): Stats {
  const n = errors.length
  const meanK = errors.reduce((a, b) => a + b, 0) / n
  const rmsK = Math.sqrt(errors.reduce((a, b) => a + b * b, 0) / n)
  const worstK = Math.max(...errors.map(Math.abs))
  return { n, meanK, rmsK, worstK }
}

const fmt = (s: Stats) => `n ${s.n}, mean ${s.meanK >= 0 ? '+' : ''}${s.meanK.toFixed(1)} K, rms ${s.rmsK.toFixed(1)} K, worst ${s.worstK.toFixed(1)} K`

/** One measured sol: its Earth date at local noon (for the season) and its measured extremes, kelvin. */
interface MeasuredSol {
  dateUtc: string
  minK: number
  maxK: number
}

interface SiteRun {
  night: Stats
  day: Stats
  together: Stats
  report: string
}

function runSite(name: string, point: MarsCoordinate, cell: SurfaceThermalProperties, elevationM: number, sols: readonly MeasuredSol[]): SiteRun {
  if (!isAvailable(cell.thermalInertia) || !isAvailable(cell.albedo)) throw new Error(`no TES cell at ${name}`)
  const pressure = surfacePressurePa(elevationM)
  const minErrors: number[] = []
  const maxErrors: number[] = []
  for (const sol of sols) {
    // The sol's season from its date at local noon: declination and distance.
    const s = mars24Steps(Date.parse(`${sol.dateUtc}T12:00:00Z`))
    const curve = diurnalCurve({
      latitudeDeg: point.latitude,
      solarDeclinationDeg: s.solarDeclinationDeg,
      heliocentricDistanceAu: s.heliocentricDistanceAu,
      thermalInertia: cell.thermalInertia.value,
      albedo: cell.albedo.value,
      surfacePressurePa: pressure,
    })
    const { minK, maxK } = curveExtremes(curve)
    minErrors.push(minK - sol.minK)
    maxErrors.push(maxK - sol.maxK)
  }
  const night = stats(minErrors)
  const day = stats(maxErrors)
  const together = stats([...minErrors, ...maxErrors])
  const report = `Model − measured at ${name} (TES cell: thermal inertia ${cell.thermalInertia.value}, albedo ${cell.albedo.value}). Night minimum: ${fmt(night)}. Day maximum: ${fmt(day)}. Together: ${fmt(together)}.`
  return { night, day, together, report }
}

/** What the basis text the UI shows must say about a site's run, so the number on screen describes this very run. */
function expectBasisDescribes(run: SiteRun, cell: SurfaceThermalProperties) {
  expect(VALIDATED_ERROR.basis).toContain(`${run.together.n / 2} sols`)
  expect(VALIDATED_ERROR.basis).toContain(`worst ${Math.ceil(run.together.worstK)} K`)
  if (isAvailable(cell.thermalInertia)) expect(VALIDATED_ERROR.basis).toContain(`thermal inertia ${cell.thermalInertia.value}`)
  if (isAvailable(cell.albedo)) expect(VALIDATED_ERROR.basis).toContain(`albedo ${cell.albedo.value}`)
}

describe('thermal model against MEDA at Jezero', () => {
  const extract = parseMedaExtract(MEDA_JEZERO_RAW)
  if (typeof extract === 'string') throw new Error(extract)
  type CoveredSol = MedaSolRecord & { min: MedaSample; max: MedaSample }
  const sampled = extract.records.filter(
    (r, i): r is CoveredSol => r.min !== null && r.max !== null && coversHours(r.hoursMask, MEDA_EXTREME_HOURS) && i % EVERY_NTH_MEDA_SOL === 0,
  )

  it('samples enough sols across the extract to cover every season', () => {
    expect(sampled.length).toBeGreaterThan(80)
    expect(sampled[0].sol).toBeLessThan(100)
    expect(sampled[sampled.length - 1].sol).toBeGreaterThan(1700)
  })

  it('stays within the recorded error, minimum and maximum together', { timeout: 60_000 }, async () => {
    const cell = (await readCommittedTesGrids()).properties(JEZERO.centre)
    const sols = sampled.map((r) => ({ dateUtc: r.dateUtc, minK: r.min.temperatureK, maxK: r.max.temperatureK }))
    const run = runSite('Jezero', JEZERO.centre, cell, JEZERO_FLOOR_ELEVATION_M, sols)
    console.info(run.report)
    expect(run.together.rmsK, run.report).toBeLessThanOrEqual(VALIDATED_ERROR.errorK)
    expectBasisDescribes(run, cell)
  })
})

describe('thermal model against REMS at Gale, the independent check', () => {
  const records = parseRemsFeed(REMS_GALE_SAMPLED_RAW)
  if (typeof records === 'string') throw new Error(records)
  const sampled = records.filter((r): r is typeof r & { minGroundC: number; maxGroundC: number } => r.minGroundC !== null && r.maxGroundC !== null)

  it('is the feed’s own rows, sampled across every season of the mission', () => {
    expect(REMS_GALE_SAMPLE_PROVENANCE.rule).toMatch(/every 20th sol/)
    expect(sampled.length).toBe(records.length)
    expect(sampled.length).toBeGreaterThan(200)
    expect(sampled[0].sol).toBeLessThan(100)
    expect(sampled[sampled.length - 1].sol).toBeGreaterThan(4900)
    // Oldest first and strictly increasing, as the build writes them.
    for (let i = 1; i < sampled.length; i++) expect(sampled[i].sol).toBeGreaterThan(sampled[i - 1].sol)
  })

  it('reads the one TES cell the traverse lies in, and its frost floor is far below any Gale night', async () => {
    const grids = await readCommittedTesGrids()
    const cell = grids.properties(GALE_LANDING)
    expect(cell.thermalInertia.classification).toBe('OFFICIAL')
    expect(cell.albedo.classification).toBe('OFFICIAL')
    // The same cell at the traverse's far end (the sulfate unit, about 4.75°S 137.35°E).
    expect(grids.thermalInertia({ latitude: -4.75, longitudeEast: 137.35 })).toEqual(cell.thermalInertia)
    // About 151 K at −4501 m against a coldest measured sol near 169 K: the floor never binds, so the rover's later heights do not matter.
    const frostK = co2FrostPointK(surfacePressurePa(GALE_LANDING_ELEVATION_M))
    const coldestK = Math.min(...sampled.map((r) => r.minGroundC)) + CELSIUS_OFFSET_K
    expect(frostK).toBeLessThan(coldestK - 10)
  })

  it('stays within the recorded error, minimum and maximum together', { timeout: 60_000 }, async () => {
    const cell = (await readCommittedTesGrids()).properties(GALE_LANDING)
    const sols = sampled.map((r) => ({ dateUtc: r.dateUtc, minK: r.minGroundC + CELSIUS_OFFSET_K, maxK: r.maxGroundC + CELSIUS_OFFSET_K }))
    const run = runSite('Gale', GALE_LANDING, cell, GALE_LANDING_ELEVATION_M, sols)
    console.info(run.report)
    expect(run.together.rmsK, run.report).toBeLessThanOrEqual(VALIDATED_ERROR.errorK)
    expectBasisDescribes(run, cell)
  })
})
