import { describe, expect, it } from 'vitest'
import { DEFAULT_MISSION_SETTINGS, derived, official, unavailable, walkPlanProblem, type GeologicUnit, type GeologicUnitArea, type WalkPlan } from '../../src/domain'
import { SAMPLE_INSET_KM, TRANSECT_COMPOSITION, TRANSECT_GOAL, TRANSECT_REASONS, isOwnRim, transectLine, type NamedCrater } from '../../src/features/route-analysis/transectLine'
import { confirmTransectSamples, transectWalk } from '../../src/features/route-analysis/transectWalk'
import { RETURN_STOP_LABEL } from '../../src/features/route-analysis/scienceGoals'
import { START, at, xOf, MAP, unit, UNITS, CONTACTS, NEAREST_NOTE, settings, lineOf, profileOf, walkOf } from '../fixtures/transect'

describe('the transect line', () => {
  it('runs from just past the nearest rim point, through the landing site', () => {
    const line = lineOf()
    expect(line.startIndex).toBe(1)
    expect(line.path).toHaveLength(2)
    expect(line.path[1]).toEqual(START)
    expect(line.reachesRim).toBe(true)
    expect(line.floor).toBe('under-start')
    expect(line.startUnit?.name).toBe('Jezero floor unit')
    // The nearest rim point is 3 km west, 50 m inside the unit; the line runs 150 m past it.
    expect(xOf(line.path[0])).toBeCloseTo(-3.2, 2)
    expect(line.outKm).toBeCloseTo(3.2, 2)
  })

  it('covers the part that fits when the rim is farther than the reach, and says it stops short', () => {
    const line = lineOf(START, UNITS, 2)
    expect(line.reachesRim).toBe(false)
    expect(line.outKm).toBeCloseTo(2, 6)
    expect(xOf(line.path[0])).toBeCloseTo(-2, 2)
    expect(line.rimKm).toBeCloseTo(3.05, 2)
  })

  it('goes on to the nearest floor unit when the landing site is not on the floor', () => {
    const line = lineOf(at(-1, 0))
    expect(line.path).toHaveLength(3)
    expect(line.startUnit?.name).toBe('Jezero fan 2 unit')
    expect(xOf(line.path[2])).toBeGreaterThan(-0.5)
  })

  it('starts at the landing site when that stands on the rim unit', () => {
    const line = lineOf(at(-3.3, 0))
    expect(line.startIndex).toBe(0)
    expect(line.outKm).toBe(0)
    expect(line.path[0]).toEqual(at(-3.3, 0))
  })

  it('is UNAVAILABLE where the map has no rim unit', () => {
    expect(transectLine(START, UNITS.slice(1))).toEqual({ classification: 'UNAVAILABLE', reason: TRANSECT_REASONS.noRim })
  })
})

describe('the transect walk', () => {
  it('samples distinct units in rim-to-floor order, out to the rim-side end and back to the landing site', () => {
    const walk = walkOf(lineOf())
    expect(walk.unitsCrossed).toEqual(['Crater rim unit', 'Upper etched unit', 'Jezero fan 2 unit', 'Jezero floor unit'])
    expect(walk.samples).toHaveLength(DEFAULT_MISSION_SETTINGS.samples)
    expect(walk.samples.map((s) => s.sample.order)).toEqual([1, 2, 3, 4, 5, 6])
    const xs = walk.samples.map((s) => xOf(s.sample.coordinate))
    expect([...xs].sort((a, b) => a - b)).toEqual(xs)
    expect(walk.stops.map((s) => s.label)).toEqual(['Start', 'Stop 1 · Crater rim unit', 'Stop 2 · back at the landing site'])
    expect(walk.stops[2].coordinate).toEqual(START)
    expect(walk.notes).toEqual([NEAREST_NOTE])
  })

  it('puts no sample on a contact: each stands the inset or more inside its unit', () => {
    for (const s of walkOf(lineOf()).samples) {
      const x = xOf(s.sample.coordinate)
      for (const contact of CONTACTS) expect(Math.abs(x - contact)).toBeGreaterThanOrEqual(SAMPLE_INSET_KM - 1e-6)
      expect(s.unit.classification).toBe('OFFICIAL')
    }
  })

  it('makes a plan the walk contract accepts, with straight legs between its stops', () => {
    const walk = walkOf(lineOf(at(-1, 0)))
    // The landing site, the rim-side end, the landing site passed again, the floor end, and back to the landing site.
    expect(walk.stops.length).toBe(5)
    expect(walk.stops[4].label).toBe(RETURN_STOP_LABEL)
    expect(walk.stops[4].coordinate).toEqual(walk.stops[0].coordinate)
    const plan: WalkPlan = {
      goal: TRANSECT_GOAL,
      stops: walk.stops,
      legs: walk.stops.slice(1).map((to, i) => ({
        fromStopId: walk.stops[i].id,
        toStopId: to.id,
        path: derived([walk.stops[i].coordinate, to.coordinate], 'fixture: the straight line'),
        distanceKm: unavailable('fixture'),
        steepestSlopeDeg: unavailable('fixture'),
        hazards: unavailable('fixture'),
      })),
      slopeLimit: { deg: DEFAULT_MISSION_SETTINGS.maxSlopeDeg, label: 'fixture', source: 'fixture' },
      kind: 'rim-to-floor',
      settings: DEFAULT_MISSION_SETTINGS,
      samples: walk.samples.map((s) => s.sample),
    }
    expect(walkPlanProblem(plan)).toBeNull()
  })

  it('stops where the rim wall is over the slope limit, and says so', () => {
    // Level east of −2 km; west of it the ground climbs 1 m per metre (45°).
    const walk = walkOf(lineOf(), settings(), (x) => (x < -2 ? -2500 + (-2 - x) * 1000 : -2500))
    expect(walk.unitsCrossed).toEqual(['Upper etched unit', 'Jezero fan 2 unit', 'Jezero floor unit'])
    expect(Math.min(...walk.path.map(xOf))).toBeGreaterThanOrEqual(-2.02)
    expect(walk.notes.join(' ')).toContain('slope limit')
    const steepest = walk.budget.steepestDeg
    expect(steepest.classification === 'DERIVED' && steepest.value <= 20).toBe(true)
  })

  it('stops where a height is missing', () => {
    const walk = walkOf(lineOf(), settings(), (x) => (x < -2 ? Number.NaN : -2500))
    expect(Math.min(...walk.path.map(xOf))).toBeGreaterThanOrEqual(-2.02)
    expect(walk.budget.walkingMin.classification).toBe('DERIVED')
  })

  it('is shortened to the units an hour allows, and says so', () => {
    const walk = walkOf(lineOf(), settings({ durationMin: 60 }))
    expect(walk.unitsCrossed).toEqual(['Jezero fan 2 unit', 'Jezero floor unit'])
    const total = walk.budget.totalMin
    expect(total.classification === 'DERIVED' && total.value <= 60).toBe(true)
    expect(walk.notes.join(' ')).toContain('does not fit the duration')
  })

  it('takes fewer samples than units when the settings ask for fewer, keeping the widest outcrops', () => {
    const walk = walkOf(lineOf(), settings({ samples: 2 }))
    expect(walk.samples).toHaveLength(2)
    expect(new Set(walk.unitsCrossed).size).toBe(2)
  })

  it('is UNAVAILABLE with the limit that stops it when not even two units fit', () => {
    const walk = transectWalk(lineOf(), profileOf(lineOf()), UNITS, settings({ durationMin: 10 }))
    expect(walk.classification).toBe('UNAVAILABLE')
    expect(walk.classification === 'UNAVAILABLE' && walk.reason).toMatch(/over the duration limit by \d+ min/)
  })

  it('is UNAVAILABLE when the ground beside the landing site cannot be walked either way', () => {
    const walk = transectWalk(lineOf(), profileOf(lineOf(), () => Number.NaN), UNITS, settings())
    expect(walk).toEqual({ classification: 'UNAVAILABLE', reason: TRANSECT_REASONS.slope(20) })
  })

  it('is UNAVAILABLE when the walkable part crosses no contact', () => {
    // A wall 200 m west of the start: only the floor unit can be walked.
    const walk = transectWalk(lineOf(), profileOf(lineOf(), (x) => (x < -0.2 ? Number.NaN : -2500)), UNITS, settings())
    expect(walk).toEqual({ classification: 'UNAVAILABLE', reason: TRANSECT_REASONS.oneUnit('Jezero floor unit') })
  })

  it('refuses heights that are not the line\'s', () => {
    const other = profileOf(lineOf(at(0.5, 0.5)))
    expect(transectWalk(lineOf(), other, UNITS, settings())).toEqual({ classification: 'UNAVAILABLE', reason: TRANSECT_REASONS.noProfile })
  })
})

describe('what the transect says of the ground', () => {
  it('never says a mineral was measured or will be found: composition is UNAVAILABLE', () => {
    expect(TRANSECT_COMPOSITION.classification).toBe('UNAVAILABLE')
    expect(walkOf(lineOf()).composition).toBe(TRANSECT_COMPOSITION)
    const words = [TRANSECT_GOAL.label, TRANSECT_GOAL.reason.classification === 'DERIVED' ? TRANSECT_GOAL.reason.value : '']
    for (const stop of walkOf(lineOf()).stops) if (stop.reason.classification === 'DERIVED') words.push(stop.label, stop.reason.value)
    for (const text of words) expect(text).not.toMatch(/measured|will be found|contains|detected|rich in/i)
    expect(TRANSECT_GOAL.reason.classification === 'DERIVED' && TRANSECT_GOAL.reason.value).toContain('Composition is not known')
  })

  it('quotes the map\'s description of the unit the map reads at each exact point', () => {
    const samples = walkOf(lineOf()).samples
    // The polygons carry no text here, so a sample has no description until the map is read.
    expect(samples[0].description.classification).toBe('UNAVAILABLE')
    const reads = samples.map((_, i) =>
      i === 1 ? unavailable<GeologicUnit>('fixture: on a contact') : official(unit('Read unit', 'Fixture description of the ground.'), MAP.citation),
    )
    const confirmed = confirmTransectSamples(samples, reads)
    expect(confirmed[0].description).toEqual({
      classification: 'OFFICIAL',
      value: 'Read unit: "Fixture description of the ground."',
      source: MAP.citation,
    })
    expect(confirmed[1].unit).toEqual({ classification: 'UNAVAILABLE', reason: 'fixture: on a contact' })
    expect(confirmed[1].description).toEqual({ classification: 'UNAVAILABLE', reason: 'fixture: on a contact' })
    expect(confirmed.map((s) => s.sample)).toEqual(samples.map((s) => s.sample))
  })
})

describe("the main crater's own rim", () => {
  // A 20 km crater centred 8 km east of the start: its rim crosses 2 km west of the start.
  const CRATER: NamedCrater = { name: 'Fixture', centre: at(8, 0), diameterKm: 20, source: 'fixture gazetteer', others: [{ centre: at(-1.2, 0), diameterKm: 0.6 }] }
  const patch = (name: string, x0: number, x1: number, y = 1): GeologicUnitArea => ({ unit: unit(name), rings: [[at(x0, -y), at(x1, -y), at(x1, y), at(x0, y)]] })
  const small = patch('Crater rim unit', -1.4, -1, 0.2)
  const own = patch('Crater rim unit', -2.6, -2)
  const far = patch('Crater rim unit', -9, -8.5)
  const floor = patch('Jezero floor unit', -1, 3)
  const between = patch('Upper etched unit', -2, -1.4)

  it('reads an outcrop as the crater\'s own by its distance from the centre, and not one at another named crater', () => {
    expect(isOwnRim(own, CRATER)).toBe(true)
    // 9.2 km from the centre, in the band, but at the smaller named crater.
    expect(isOwnRim(small, CRATER)).toBe(false)
    // 16.75 km from the centre: 1.7 radii, outside the band.
    expect(isOwnRim(far, CRATER)).toBe(false)
    expect(isOwnRim(patch('Crater rim unit', 7, 9), CRATER)).toBe(false)
  })

  it('runs from the crater\'s own rim when that is within reach, past a nearer small crater\'s rim', () => {
    const line = transectLine(START, [small, own, floor, between], 5, CRATER)
    expect(line.classification).toBe('DERIVED')
    if (line.classification !== 'DERIVED') return
    expect(line.value.rimOf).toBe('Fixture')
    expect(line.value.rimKm).toBeCloseTo(2.05, 2)
    expect(line.method).toContain("Fixture crater's own rim")
    expect(line.method).toContain('fixture gazetteer')
    expect(line.method).toContain('project choice')
  })

  it('falls back to the nearest outcrop when the crater\'s own rim is out of reach, and the walk says which', () => {
    const line = transectLine(START, [small, own, floor, between], 1.5, CRATER)
    expect(line.classification === 'DERIVED' && line.value.rimOf).toBeNull()
    expect(line.classification === 'DERIVED' && line.value.rimKm).toBeCloseTo(1.05, 2)
    const named = transectLine(START, UNITS, 5, { ...CRATER, centre: at(40, 0) })
    expect(named.classification === 'DERIVED' && named.value.rimOf).toBeNull()
  })

  it('says nothing of a smaller crater when the line runs from the crater\'s own rim', () => {
    const units = [own, between, patch('Jezero fan 2 unit', -1.4, -0.5), patch('Jezero floor unit', -0.5, 3)]
    const line = transectLine(START, units, 5, CRATER)
    if (line.classification !== 'DERIVED') throw new Error('no line')
    const walk = transectWalk(line.value, profileOf(line.value), units, settings())
    expect(walk.classification).toBe('DERIVED')
    if (walk.classification !== 'DERIVED') return
    expect(walk.value.notes).toEqual([])
    expect(walk.value.unitsCrossed[0]).toBe('Crater rim unit')
  })
})
