import { describe, expect, it } from 'vitest'
import { spannedAreaKm2 } from '../../src/features/route-analysis/sampleSpread'
import { plannedWalks, planWalks, type WalksPlanner } from '../../src/app/planWalks'
import { sampleProfile, type ProfileHeights } from '../../src/app/routeProfile'
import { craterFromNames, walkDrafts, type WalkDraftSources } from '../../src/app/walkDrafts'
import { createWalkPlanner } from '../../src/app/walkPlanner'
import type { HeightModel } from '../../src/data/adapters/LayeredElevation'
import type { PlaceName } from '../../src/data/adapters/PlaceNamesAdapter'
import {
  DEFAULT_MISSION_SETTINGS,
  official,
  unavailable,
  walkPlanProblem,
  type GeologicFeatures,
  type GeologicUnit,
  type RoverTraverse,
} from '../../src/domain'
import { FLAT_BEDROCK_REASONS } from '../../src/features/route-analysis/flatBedrockWalk'
import { ROVER_CHECK_GOAL } from '../../src/features/route-analysis/roverCheckWalk'
import { RETURN_STOP_LABEL } from '../../src/features/route-analysis/scienceGoals'
import { TRANSECT_GOAL } from '../../src/features/route-analysis/transectLine'
import { MAP, START, UNITS, at, xOf } from '../fixtures/transect'

// Test fixtures only: the transect's invented strips (rim to the west, the
// floor the start stands on), flat heights, and an invented rover path east.
const SITE = { name: 'Fixture crater', map: { ...MAP, id: 'SIM 3464' }, bounds: { west: 77, east: 78, south: 18, north: 19 } }
const MODEL: HeightModel = { cellKm: 0.02, label: 'fixture CTX', source: 'fixture CTX', site: true }
const flat = (points: Float64Array) => new Float32Array(points.length / 2).fill(-2500)
const signal = () => new AbortController().signal

/** The strip a point stands in, as the map's read of that exact point. */
const unitAt = async (p: { latitude: number; longitudeEast: number }) => {
  const x = xOf(p)
  const strip = UNITS.find((u) => {
    const xs = u.rings[0].map(xOf)
    return x >= Math.min(...xs) && x <= Math.max(...xs)
  })
  return strip ? official<GeologicUnit>(strip.unit, MAP.citation) : unavailable<GeologicUnit>('fixture: no unit here')
}

const ROVER: RoverTraverse = {
  rover: 'perseverance',
  source: 'fixture feed',
  retrievedUtcMs: 0,
  points: [1, 2, 3].map((x, i) => ({
    coordinate: at(x, 0),
    sol: 100 + i,
    rmc: { site: 7, drive: i },
    elevationMeters: unavailable('fixture'),
    tiltDegrees: unavailable('fixture'),
  })),
}

const heights: ProfileHeights = {
  elevationsAt: async (points) => {
    const h = flat(points)
    return official({ heights: h, sourceIndex: new Uint8Array(h.length), sources: [MODEL] }, 'fixture chain')
  },
  description: 'fixture heights',
  noDataReason: 'fixture: no height',
  cellKmAlong: () => 0.02,
}

function setup(over: Partial<WalkDraftSources> = {}): WalksPlanner {
  const planner = createWalkPlanner({
    site: SITE,
    units: async () => official(UNITS, MAP.citation),
    unitAt,
    features: async () => official<GeologicFeatures>({ points: [], lines: [], areas: [] }, MAP.citation),
    heights: async (points) => {
      const h = flat(points)
      return official({ heights: h, model: new Uint8Array(h.length), models: [MODEL] }, 'fixture chain')
    },
    cellKmAlong: () => 0.02,
    traverse: async () => official(ROVER, 'fixture feed'),
  })
  const profile: WalksPlanner['profile'] = (path, s) => sampleProfile(path, heights, s)
  return {
    drafts: walkDrafts(planner, {
      site: SITE,
      units: async () => official(UNITS, MAP.citation),
      unitAt,
      traverse: async () => official(ROVER, 'fixture feed'),
      profile,
      crater: async () => unavailable('fixture: no place names'),
      ...over,
    }),
    walkLegs: planner.walkLegs,
    profile,
  }
}

async function plan(p = setup()) {
  const out = await planWalks(p, START, DEFAULT_MISSION_SETTINGS, signal())
  if (out === 'aborted') throw new Error('aborted')
  return out
}

describe('walkDrafts: the flat bedrock', () => {
  it('walks a loop over the floor the landing site stands on, samples on it and spread over ground, and the contract accepts it', async () => {
    const floor = (await plan()).find((o) => o.kind === 'flat-bedrock')
    if (floor?.status !== 'planned') throw new Error(`expected a flat-bedrock walk: ${JSON.stringify(floor)}`)
    expect(walkPlanProblem(floor.plan)).toBeNull()
    expect(floor.plan.stops.slice(1).every((s) => s.unit.classification !== 'UNAVAILABLE' && s.unit.value.name === 'Jezero floor unit')).toBe(true)
    expect(floor.plan.samples).toHaveLength(DEFAULT_MISSION_SETTINGS.samples)
    for (const sample of floor.plan.samples!) {
      const u = await unitAt(sample.coordinate)
      expect(u.classification !== 'UNAVAILABLE' && u.value.name).toBe('Jezero floor unit')
    }
    // A loop: the samples go round it, the way back included, so they span ground and the note says how much.
    expect(spannedAreaKm2(floor.plan.samples!.map((s) => s.coordinate))).toBeGreaterThan(0.1)
    expect(floor.samplesNote).toMatch(/The samples span \d+\.\d\d km²/)
    expect(floor.fit.fits).toBe(true)
  })

  it('takes the next-best loop when a leg of the best is over the slope limit on the heights', async () => {
    const plannerOn = (heights: (points: Float64Array) => Float32Array) =>
      createWalkPlanner({
        site: SITE,
        units: async () => official(UNITS, MAP.citation),
        unitAt,
        features: async () => official<GeologicFeatures>({ points: [], lines: [], areas: [] }, MAP.citation),
        heights: async (points) => {
          const h = heights(points)
          return official({ heights: h, model: new Uint8Array(h.length), models: [MODEL] }, 'fixture chain')
        },
        cellKmAlong: () => 0.02,
        traverse: async () => unavailable('fixture'),
      })
    const onFlat = await plannerOn(flat).flatBedrock(START, DEFAULT_MISSION_SETTINGS, signal())
    if (onFlat.classification !== 'DERIVED') throw new Error('expected a draft on flat ground')
    expect(onFlat.value.notes).toBeUndefined()
    // A 300 m scarp across the best loop's first leg, halfway to its first stop.
    const wallX = xOf(onFlat.value.stops[1].coordinate) / 2
    expect(Math.abs(wallX)).toBeGreaterThan(0.1)
    const scarp = (points: Float64Array) => {
      const h = new Float32Array(points.length / 2)
      for (let i = 0; i < h.length; i++) {
        const x = xOf({ latitude: points[i * 2], longitudeEast: points[i * 2 + 1] })
        h[i] = (wallX > 0 ? x > wallX : x < wallX) ? -2200 : -2500
      }
      return h
    }
    const onScarp = await plannerOn(scarp).flatBedrock(START, DEFAULT_MISSION_SETTINGS, signal())
    if (onScarp.classification !== 'DERIVED') throw new Error('expected a draft beside the scarp')
    expect(onScarp.value.loop).toBe(true)
    expect(onScarp.value.notes?.join(' ')).toMatch(/^Loop \d+ of the \d+ best/)
    // Every stop of the loop taken is on the landing site's side of the scarp.
    for (const stop of onScarp.value.stops) expect(wallX > 0 ? xOf(stop.coordinate) < wallX : xOf(stop.coordinate) > wallX).toBe(true)
  })

  it('says the map’s reads disagreed when they drop every stop, not that no floor is in reach', async () => {
    const other = async () => official<GeologicUnit>({ symbol: 'x', name: 'Another unit', map: MAP }, MAP.citation)
    const planner = createWalkPlanner({
      site: SITE,
      units: async () => official(UNITS, MAP.citation),
      unitAt: other,
      features: async () => official<GeologicFeatures>({ points: [], lines: [], areas: [] }, MAP.citation),
      heights: async (points) => official({ heights: flat(points), model: new Uint8Array(points.length / 2), models: [MODEL] }, 'f'),
      cellKmAlong: () => 0.02,
      traverse: async () => unavailable('fixture'),
    })
    const draft = await planner.flatBedrock(START, DEFAULT_MISSION_SETTINGS, signal())
    expect(draft).toEqual({ classification: 'UNAVAILABLE', reason: FLAT_BEDROCK_REASONS.otherUnits })
  })
})

describe('walkDrafts: the rim-to-floor transect', () => {
  it('plans the transect with its own samples, each on a unit the map read, and the contract accepts it', async () => {
    const out = await plan()
    const transect = out.find((o) => o.kind === 'rim-to-floor')
    if (transect?.status !== 'planned') throw new Error(`expected a transect: ${JSON.stringify(transect)}`)
    expect(transect.plan.goal).toBe(TRANSECT_GOAL)
    expect(walkPlanProblem(transect.plan)).toBeNull()
    expect(transect.plan.samples!.length).toBeGreaterThanOrEqual(2)
    // The samples stand on more than one unit: the point of the walk.
    const units = await Promise.all(transect.plan.samples!.map((s) => unitAt(s.coordinate)))
    expect(new Set(units.map((u) => (u.classification === 'UNAVAILABLE' ? null : u.value.name))).size).toBeGreaterThan(1)
  })

  it('says in its note that composition is not known', async () => {
    const transect = (await plan()).find((o) => o.kind === 'rim-to-floor')
    if (transect?.status !== 'planned') throw new Error('expected a transect')
    expect(transect.samplesNote).toContain('no mineral dataset')
    // Without the place names, the line runs from the nearest rim outcrop and says so.
    expect(transect.samplesNote).toContain('may be the rim of a smaller crater')
  })

  it('is UNAVAILABLE with the reason when the map cannot be read, and the other walks still plan', async () => {
    const out = await plan(setup({ units: async () => unavailable('fixture: service down') }))
    expect(out.find((o) => o.kind === 'rim-to-floor')).toMatchObject({
      status: 'unavailable',
      reason: "The map's units could not be read: fixture: service down",
    })
    expect(out.find((o) => o.kind === 'rover-check')?.status).toBe('planned')
  })
})

describe('walkDrafts: the rover check', () => {
  it('stops at the rover’s waypoints, a sample at each, its goal naming no unit, and the contract accepts it', async () => {
    const check = (await plan()).find((o) => o.kind === 'rover-check')
    if (check?.status !== 'planned') throw new Error(`expected a rover check: ${JSON.stringify(check)}`)
    expect(check.plan.goal).toBe(ROVER_CHECK_GOAL)
    expect(walkPlanProblem(check.plan)).toBeNull()
    expect(check.plan.stops.map((s) => s.label)).toEqual(['Start', 'Stop 1 · sol 100', 'Stop 2 · sol 101', 'Stop 3 · sol 102', RETURN_STOP_LABEL])
    // The walk ends where it began, and its last leg is the way back.
    expect(check.plan.stops[4].coordinate).toEqual(check.plan.stops[0].coordinate)
    expect(check.plan.legs).toHaveLength(4)
    expect(check.plan.legs[3]).toMatchObject({ fromStopId: check.plan.stops[3].id, toStopId: check.plan.stops[4].id })
    expect(check.fit.fits).toBe(true)
    expect(check.plan.samples!.map((s) => s.coordinate)).toEqual(ROVER.points.map((p) => p.coordinate))
    expect(check.plan.stops[1].reason).toMatchObject({ classification: 'OFFICIAL', value: 'Perseverance was here on sol 100 (site 7, drive 0)' })
  })

  it('keeps the waypoints before a missing height, and says why the rest were left off', async () => {
    // No height past 1.5 km east: the walk to the second waypoint (2 km) cannot be checked.
    const gappy: ProfileHeights = {
      ...heights,
      elevationsAt: async (points) => {
        const h = flat(points)
        for (let i = 0; i < h.length; i++) if (xOf({ latitude: points[i * 2], longitudeEast: points[i * 2 + 1] }) > 1.5) h[i] = Number.NaN
        return official({ heights: h, sourceIndex: new Uint8Array(h.length), sources: [MODEL] }, 'fixture chain')
      },
    }
    const check = (await plan(setup({ profile: (path, s) => sampleProfile(path, gappy, s) }))).find((o) => o.kind === 'rover-check')
    if (check?.status !== 'planned') throw new Error(`expected a rover check: ${JSON.stringify(check)}`)
    expect(check.plan.stops.map((s) => s.label)).toEqual(['Start', 'Stop 1 · sol 100', RETURN_STOP_LABEL])
    expect(check.samplesNote).toMatch(/^2 more waypoints were left off: the walk to the next could not be checked \(.*not known\): /)
  })

  it('is UNAVAILABLE with the reason when the rover path cannot be read, or throws', async () => {
    const down = await plan(setup({ traverse: async () => unavailable('fixture: feed down') }))
    expect(down.find((o) => o.kind === 'rover-check')).toMatchObject({
      status: 'unavailable',
      reason: 'The Perseverance traverse could not be read: fixture: feed down',
    })
    const throws = await plan(
      setup({
        traverse: async () => {
          throw new Error('fixture failure')
        },
      }),
    )
    expect(throws.find((o) => o.kind === 'rover-check')).toMatchObject({ status: 'unavailable' })
    expect(plannedWalks(throws).some((w) => w.kind === 'rim-to-floor')).toBe(true)
  })

  it('refuses a landing site off the map sheet, for every walk that reads one', async () => {
    const off = at(0, 0)
    const out = await planWalks(setup({ site: { ...SITE, bounds: { west: 70, east: 71, south: 10, north: 11 } } }), off, DEFAULT_MISSION_SETTINGS, signal())
    if (out === 'aborted') throw new Error('aborted')
    for (const kind of ['rim-to-floor', 'rover-check'] as const) {
      expect(out.find((o) => o.kind === kind)).toMatchObject({ status: 'unavailable', reason: expect.stringContaining('outside the') })
    }
  })
})

describe('walkDrafts: with the place names, and with fewer samples than waypoints', () => {
  it('runs the transect from the named crater’s own rim when it is within reach', async () => {
    // A fixture crater centred 8 km east of the start, so the fixture's rim strip, 3–3.6 km west, sits about 1 radius out.
    const crater = { name: 'Fixture', centre: at(8, 0), diameterKm: 23, source: 'fixture gazetteer', others: [] }
    const out = await plan(setup({ crater: async () => official(crater, 'fixture gazetteer') }))
    const transect = out.find((o) => o.kind === 'rim-to-floor')
    if (transect?.status !== 'planned') throw new Error(`expected a transect: ${JSON.stringify(transect)}`)
    expect(transect.samplesNote ?? '').not.toContain('may be the rim of a smaller crater')
  })

  it('says how many waypoints were left off when the time runs out', async () => {
    // 100 min: out to the first waypoint 1 km away and back fits; out to the second, 2 km away, and back does not.
    const out = await planWalks(setup(), START, { ...DEFAULT_MISSION_SETTINGS, durationMin: 100 }, signal())
    if (out === 'aborted') throw new Error('aborted')
    const check = out.find((o) => o.kind === 'rover-check')
    if (check?.status !== 'planned') throw new Error(`expected a rover check: ${JSON.stringify(check)}`)
    expect(check.plan.samples!.length).toBeLessThan(3)
    expect(check.samplesNote).toMatch(/^\d more waypoints? (was|were) left off: the walk to the next and back would break the duration limit\.$/)
  })
})

describe('the contract: only the rover check may name no unit', () => {
  it('refuses an empty goal on any other kind of walk', async () => {
    const check = plannedWalks(await plan()).find((w) => w.kind === 'rover-check')!
    expect(walkPlanProblem({ ...check.plan, kind: 'flat-bedrock' })).toBe('The goal names no geologic unit')
  })
})

describe('craterFromNames', () => {
  const name = (n: string, type: string, x: number, diameterKm: number | null, featureId = 1): PlaceName => ({
    featureId,
    name: n,
    type,
    coordinate: at(x, 0),
    diameterKm,
  })
  it('gives the crater and the named craters within one and a half of its diameters', () => {
    const names = [
      name('Fixture', 'Crater', 0, 40),
      name('Near', 'Crater', 30, 2),
      name('Far', 'Crater', 100, 3),
      name('Nameless size', 'Crater', 5, null),
      name('Valley', 'Vallis', 5, 10),
    ]
    const c = craterFromNames(names, 'Fixture', 'fixture gazetteer')
    expect(c).toMatchObject({ classification: 'OFFICIAL', value: { name: 'Fixture', diameterKm: 40, source: 'fixture gazetteer' } })
    if (c.classification === 'UNAVAILABLE') return
    expect(c.value.others).toEqual([{ centre: at(30, 0), diameterKm: 2 }])
  })

  it('is UNAVAILABLE where the name is not a crater with a diameter', () => {
    expect(craterFromNames([name('Fixture', 'Crater', 0, null)], 'Fixture', 's').classification).toBe('UNAVAILABLE')
    expect(craterFromNames([], 'Jezero', 's').classification).toBe('UNAVAILABLE')
  })
})
