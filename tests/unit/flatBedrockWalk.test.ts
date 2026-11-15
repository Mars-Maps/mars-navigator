import { describe, expect, it } from 'vitest'
import {
  DEFAULT_MISSION_SETTINGS,
  MARS_MEAN_RADIUS_KM,
  type GeologicMap,
  type GeologicUnit,
  type GeologicUnitArea,
  type MarsCoordinate,
  type MissionSettings,
} from '../../src/domain'
import {
  FLAT_BEDROCK_GOAL,
  FLAT_BEDROCK_MAX_STOPS,
  FLAT_BEDROCK_REASONS,
  FLOOR_INSET_KM,
  FLAT_BEDROCK_REACH_BASIS,
  acrossFloorStops,
  flatBedrockReachKm,
  flatBedrockSamples,
  flatBedrockStops,
  floorSamplePlacesKm,
} from '../../src/features/route-analysis/flatBedrockWalk'
import { walkingKcalPerKm } from '../../src/features/route-analysis/metabolicCost'
import { surfaceDistanceKm } from '../../src/features/route-analysis/routeDistance'
import { DEFAULT_MAX_WALK_KM } from '../../src/features/route-analysis/scienceGoals'
import { MIN_SAMPLE_SPACING_M, SAMPLE_MINUTES } from '../../src/features/route-analysis/walkBudget'
import { suitedWalkingKmh } from '../../src/features/route-analysis/walkingSpeed'

// Test fixtures only: invented polygons near Jezero, never shown in the app.
const MAP: GeologicMap = { id: 'SIM 3464', title: 'Fixture map', scaleDenominator: 75000, citation: 'Fixture citation' }
const unit = (name: string): GeologicUnit => ({
  symbol: name.slice(0, 3),
  name,
  interpretation: `Fixture interpretation of ${name}. A second sentence.`,
  map: MAP,
})
const START: MarsCoordinate = { latitude: 18.44, longitudeEast: 77.45 }
const RAD = Math.PI / 180
const KM_PER_DEG_LAT = MARS_MEAN_RADIUS_KM * RAD
/** A point `x` km east and `y` km north of START. */
function at(x: number, y: number): MarsCoordinate {
  const kmPerDegLon = KM_PER_DEG_LAT * Math.cos(START.latitude * RAD)
  return { latitude: START.latitude + y / KM_PER_DEG_LAT, longitudeEast: START.longitudeEast + x / kmPerDegLon }
}
const box = (x0: number, y0: number, x1: number, y1: number) => [at(x0, y0), at(x1, y0), at(x1, y1), at(x0, y1)]
const area = (name: string, ring: MarsCoordinate[]): GeologicUnitArea => ({ unit: unit(name), rings: [ring] })
const [FLOOR, ETCHED] = FLAT_BEDROCK_GOAL.unitNames

const settings = (over: Partial<MissionSettings> = {}): MissionSettings => ({ ...DEFAULT_MISSION_SETTINGS, ...over })

describe('flatBedrockReachKm', () => {
  it('is the shorter of what the time after the samples and the energy allow on level ground, at most the map read', () => {
    const s = settings({ durationMin: 40, samples: 2, energyKcal: 10_000 })
    const byTime = ((40 - 2 * SAMPLE_MINUTES) / 60) * suitedWalkingKmh(0)
    const reach = flatBedrockReachKm(s)
    if (reach.classification !== 'DERIVED') throw new Error('expected DERIVED')
    expect(reach.value).toBeCloseTo(Math.min(byTime, 2 * DEFAULT_MAX_WALK_KM), 9)
    expect(reach.method).toMatch(/level-ground pace/)
    // The reach is the whole walk: out and back.
    expect(reach.method).toMatch(/the way back to the landing site included/)
    expect(reach.method).toMatch(/not a Mars measurement/)

    const tired = flatBedrockReachKm(settings({ durationMin: 10_000, energyKcal: 50 }))
    if (tired.classification !== 'DERIVED') throw new Error('expected DERIVED')
    expect(tired.value).toBeCloseTo(50 / walkingKcalPerKm(0), 9)

    const roomy = flatBedrockReachKm(settings({ durationMin: 10_000, energyKcal: 100_000 }))
    // Out and straight back: no stop farther than the map is read.
    expect(roomy.classification === 'DERIVED' && roomy.value).toBe(2 * DEFAULT_MAX_WALK_KM)
  })

  it('takes fewer samples rather than no walk, and says so', () => {
    // 30 min cannot hold 6 samples and any walking; 5 samples leave 5 min to walk.
    expect(flatBedrockSamples(settings({ durationMin: 30, samples: 6 }))).toBe(5)
    expect(flatBedrockSamples(settings({ durationMin: 240, samples: 6 }))).toBe(6)
    expect(flatBedrockSamples(settings({ durationMin: 60, samples: 0 }))).toBe(0)
    const fewer = flatBedrockReachKm(settings({ durationMin: 30, samples: 6, energyKcal: 10_000 }))
    if (fewer.classification !== 'DERIVED') throw new Error('expected DERIVED')
    expect(fewer.value).toBeCloseTo((5 / 60) * suitedWalkingKmh(0), 9)
    expect(fewer.method).toContain('after 5 samples of 5 min, fewer than the 6 asked for')
  })

  it('says which setting leaves no walk', () => {
    const noTime = settings({ durationMin: 5, samples: 6 })
    expect(flatBedrockSamples(noTime)).toBeNull()
    expect(flatBedrockReachKm(noTime)).toEqual({ classification: 'UNAVAILABLE', reason: FLAT_BEDROCK_REASONS.noTime(noTime) })
    const noEnergy = settings({ energyKcal: 0 })
    expect(flatBedrockReachKm(noEnergy)).toEqual({ classification: 'UNAVAILABLE', reason: FLAT_BEDROCK_REASONS.noEnergy(noEnergy) })
  })
})

describe('flatBedrockStops', () => {
  const units = [
    area(FLOOR, box(1, -0.5, 1.5, 0.5)),
    area('Jezero fan 1 unit', box(-1.5, -0.5, -1, 0.5)),
    area(ETCHED, box(-0.5, 2, 0.5, 2.5)),
  ]

  it('stops only on the crater-floor units, each with its unit from the map and a reason quoting it', () => {
    const draft = flatBedrockStops(START, units, settings())
    if (draft.classification !== 'DERIVED') throw new Error(draft.classification === 'UNAVAILABLE' ? draft.reason : 'expected DERIVED')
    const { stops, goal } = draft.value
    expect(goal).toBe(FLAT_BEDROCK_GOAL)
    expect(stops[0].coordinate).toEqual(START)
    expect(stops.length).toBe(3)
    for (const stop of stops.slice(1)) {
      expect(stop.unit.classification).toBe('OFFICIAL')
      if (stop.unit.classification === 'UNAVAILABLE') continue
      expect(FLAT_BEDROCK_GOAL.unitNames).toContain(stop.unit.value.name)
      expect(stop.reason.classification === 'DERIVED' && stop.reason.value).toMatch(/Fixture interpretation of/)
    }
  })

  /** The walk through `stops` and straight back to the first of them, km. */
  const outAndBackKm = (stops: readonly { coordinate: MarsCoordinate }[]) => {
    let km = surfaceDistanceKm(stops[stops.length - 1].coordinate, stops[0].coordinate)
    for (let i = 1; i < stops.length; i++) km += surfaceDistanceKm(stops[i - 1].coordinate, stops[i].coordinate)
    return km
  }

  it('keeps the walk, stop to stop and back to the landing site, within the reach the settings allow', () => {
    // About 2.4 km of walking: room to go to the floor stop 1 km east and come back, not to go on to the etched one 2 km north.
    const minutes = 1 * SAMPLE_MINUTES + (2.4 / suitedWalkingKmh(0)) * 60
    const draft = flatBedrockStops(START, units, settings({ samples: 1, durationMin: minutes, energyKcal: 10_000 }))
    if (draft.classification !== 'DERIVED') throw new Error('expected DERIVED')
    const { stops, reachKm, outKm } = draft.value
    expect(outAndBackKm(stops)).toBeLessThanOrEqual(reachKm)
    expect(outKm).toBeCloseTo(reachKm / 2, 9)
    expect(stops.length).toBe(2)
    expect(stops[1].unit.classification !== 'UNAVAILABLE' && stops[1].unit.value.name).toBe(FLOOR)
  })

  it('leaves off a stop the walk could reach but not come back from', () => {
    // 1.6 km of walking reaches the floor stop 1 km east, but not there and back: before the way back counted, it was kept.
    const minutes = 1 * SAMPLE_MINUTES + (1.6 / suitedWalkingKmh(0)) * 60
    const draft = flatBedrockStops(START, units, settings({ samples: 1, durationMin: minutes, energyKcal: 10_000 }))
    expect(draft.classification).toBe('UNAVAILABLE')
    if (draft.classification === 'UNAVAILABLE') expect(draft.reason).toMatch(/and still come back/)
  })

  it('counts the way back from the last stop when it takes a further one', () => {
    // The floor stop and then the etched one: 1.05 km, 2.3 km on, 2.05 km back, about 5.4 km. With 5 km the second is left off.
    const fits = flatBedrockStops(START, units, settings({ samples: 1, durationMin: SAMPLE_MINUTES + (5.6 / suitedWalkingKmh(0)) * 60, energyKcal: 10_000 }))
    const short = flatBedrockStops(START, units, settings({ samples: 1, durationMin: SAMPLE_MINUTES + (5 / suitedWalkingKmh(0)) * 60, energyKcal: 10_000 }))
    if (fits.classification !== 'DERIVED' || short.classification !== 'DERIVED') throw new Error('expected DERIVED')
    expect(fits.value.stops).toHaveLength(3)
    expect(outAndBackKm(fits.value.stops)).toBeLessThanOrEqual(fits.value.reachKm)
    expect(short.value.stops).toHaveLength(2)
  })

  it(`takes at most ${FLAT_BEDROCK_MAX_STOPS} stops after the landing site`, () => {
    const many = [0, 1, 2, 3, 4, 5].map((i) => area(FLOOR, box(0.5 + i * 0.4, -0.1, 0.7 + i * 0.4, 0.1)))
    const draft = flatBedrockStops(START, many, settings())
    expect(draft.classification === 'DERIVED' && draft.value.stops.length).toBe(FLAT_BEDROCK_MAX_STOPS + 1)
  })

  it('is UNAVAILABLE, with the reach, when no floor ground is within it', () => {
    const draft = flatBedrockStops(START, [area('Jezero fan 1 unit', box(1, -0.5, 1.5, 0.5))], settings())
    expect(draft.classification).toBe('UNAVAILABLE')
    if (draft.classification === 'UNAVAILABLE') expect(draft.reason).toMatch(/No ground of the crater-floor units/)
  })

  it('passes on why the settings leave no walk, and refuses a start it cannot plan from', () => {
    const none = flatBedrockStops(START, units, settings({ durationMin: 5, samples: 6 }))
    expect(none.classification === 'UNAVAILABLE' && none.reason).toMatch(/leaves no time to walk after even one sample/)
    const pole = flatBedrockStops({ latitude: 89, longitudeEast: 0 }, units, settings())
    expect(pole.classification).toBe('UNAVAILABLE')
  })
})

describe('a landing site on a large floor polygon', () => {
  // One 20 × 20 km floor polygon round the landing site, nothing else of the floor in reach.
  const big = [area(FLOOR, box(-10, -10, 10, 10)), area('Jezero fan 1 unit', box(10, -1, 12, 1))]

  it('walks across the polygon it stands on, rather than saying no floor is in reach', () => {
    const draft = flatBedrockStops(START, big, settings())
    if (draft.classification !== 'DERIVED') throw new Error(draft.classification === 'UNAVAILABLE' ? draft.reason : 'expected DERIVED')
    const { stops, reachKm, placements, samples } = draft.value
    expect(stops).toHaveLength(FLAT_BEDROCK_MAX_STOPS + 1)
    expect(stops[0].coordinate).toEqual(START)
    expect(samples).toBe(DEFAULT_MISSION_SETTINGS.samples)
    for (const stop of stops.slice(1)) {
      expect(stop.unit.classification !== 'UNAVAILABLE' && stop.unit.value.name).toBe(FLOOR)
      // Out along the line and back along it: no stop past half the reach.
      expect(surfaceDistanceKm(START, stop.coordinate)).toBeLessThanOrEqual(reachKm / 2 + 1e-9)
      expect(placements[stop.id]).toMatch(/across the floor polygon it stands on/)
      expect(stop.reason.classification === 'DERIVED' && stop.reason.method).toContain(FLAT_BEDROCK_REACH_BASIS)
    }
    expect(draft.method).toMatch(/across the crater-floor polygon the landing site stands on/)
  })

  it('stays inside a narrow polygon, short of its edge, along the way it reaches farthest', () => {
    // A strip 0.4 km tall and 3 km long east of the start: only east or west runs far.
    const strip = [area(FLOOR, box(-0.2, -0.2, 3, 0.2))]
    const across = acrossFloorStops(START, strip, 5)
    if (across === null) throw new Error('expected stops')
    const last = across.stops[across.stops.length - 1].coordinate
    expect(surfaceDistanceKm(START, last)).toBeCloseTo(3 - FLOOR_INSET_KM, 1)
    expect(last.longitudeEast).toBeGreaterThan(START.longitudeEast)
  })

  it('gives no stops off the floor, or where no line runs far enough for two samples', () => {
    expect(acrossFloorStops(START, [area('Jezero fan 1 unit', box(-5, -5, 5, 5))], 5)).toBeNull()
    expect(acrossFloorStops(START, [area(FLOOR, box(-0.1, -0.1, 0.1, 0.1))], 5)).toBeNull()
  })
})

describe('floorSamplePlacesKm', () => {
  // A walk 4 km east, crossing floor ground from 1 to 3 km.
  const path = [START, at(4, 0)]
  const units = [area(FLOOR, box(1, -0.5, 3, 0.5)), area('Jezero fan 1 unit', box(3, -0.5, 4, 0.5))]

  it('spreads the samples evenly over the floor ground, clear of where the walk crosses onto it or off it', () => {
    const places = floorSamplePlacesKm(path, units, 4)
    expect(places).toHaveLength(4)
    for (const km of places) {
      expect(km).toBeGreaterThanOrEqual(1 + FLOOR_INSET_KM - 0.02)
      expect(km).toBeLessThanOrEqual(3 - FLOOR_INSET_KM + 0.02)
    }
    const gaps = places.slice(1).map((km, i) => km - places[i])
    for (const g of gaps) expect(g).toBeCloseTo(gaps[0], 2)
  })

  it('puts no two closer than the samples’ minimum spacing, so fewer when the floor ground is short', () => {
    const short = [area(FLOOR, box(1, -0.5, 1.4, 0.5))]
    const places = floorSamplePlacesKm(path, short, 6)
    expect(places.length).toBeLessThan(6)
    expect(places.length).toBeGreaterThan(0)
    for (let i = 1; i < places.length; i++) expect(places[i] - places[i - 1]).toBeGreaterThanOrEqual(MIN_SAMPLE_SPACING_M / 1000 - 1e-9)
  })

  it('gives nothing to place on a walk with no floor ground, or no samples asked for', () => {
    expect(floorSamplePlacesKm(path, [area('Jezero fan 1 unit', box(1, -0.5, 3, 0.5))], 4)).toEqual([])
    expect(floorSamplePlacesKm(path, units, 0)).toEqual([])
    expect(floorSamplePlacesKm([START], units, 4)).toEqual([])
  })

  it('measures along the walk leg by leg, as the elevation profile does', () => {
    const bent = [START, at(2, 0), at(2, 2)]
    const floor = [area(FLOOR, box(1.5, -0.5, 2.5, 2.5))]
    const places = floorSamplePlacesKm(bent, floor, 3)
    const total = surfaceDistanceKm(bent[0], bent[1]) + surfaceDistanceKm(bent[1], bent[2])
    for (const km of places) {
      expect(km).toBeGreaterThan(1.5)
      expect(km).toBeLessThanOrEqual(total)
    }
  })
})
