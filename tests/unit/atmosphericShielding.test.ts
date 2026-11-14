import { describe, expect, it } from 'vitest'
import {
  RADIATION_HAZARD_UNIT,
  SHIELDING_WARNING_TEXT,
  SUITED_SLOPE_LIMIT,
  columnMassFraction,
  derived,
  official,
  shieldingWarningElevationM,
  unavailable,
  type MarsCoordinate,
  type WalkStop,
} from '../../src/domain'
import { legShieldingHazards, shieldingNotChecked } from '../../src/features/route-analysis/atmosphericShielding'
import type { ProfilePoint } from '../../src/features/route-analysis/elevationProfile'
import { walkLegs, type WalkHeights } from '../../src/features/route-analysis/walkLegs'

// Test fixtures only: invented profiles near Jezero, never shown in the app.
const at = (i: number): MarsCoordinate => ({ latitude: 18.44, longitudeEast: 77.45 + i * 0.01 })
const samples = (n: number): ProfilePoint[] => Array.from({ length: n }, (_, i) => ({ coordinate: at(i), distanceKm: i * 0.5 }))
const scan = (heights: number[]) => legShieldingHazards(samples(heights.length), heights, 'a-b', () => 'fixture DEM')
const WARN_M = shieldingWarningElevationM()

describe('legShieldingHazards', () => {
  it('has the Gale reference at a fraction of 1, and the warning line near −1.95 km', () => {
    expect(columnMassFraction(-4400)).toBeCloseTo(1, 12)
    expect(WARN_M).toBeCloseTo(-1945.4, 1)
  })

  it('gives no hazard for a leg on the Jezero floor', () => {
    expect(scan([-2600, -2580, -2550, -2570, -2600])).toEqual([])
  })

  it('gives one hazard at the highest sample of a climb past the line, with the fraction there', () => {
    const climb = [-2500, -2100, -1800, -1500, -1700, -2200]
    const hazards = scan(climb)
    expect(hazards).toHaveLength(1)
    const [h] = hazards
    expect(h.kind).toBe('radiation')
    expect(h.unit).toBe(RADIATION_HAZARD_UNIT)
    expect(h.coordinate).toEqual(at(3))
    expect(h.magnitude.classification).toBe('DERIVED')
    if (h.magnitude.classification !== 'DERIVED') return
    expect(h.magnitude.value).toBeCloseTo(Math.exp(-(-1.5 + 4.4) / 11), 12)
    expect(h.magnitude.method).toContain(`${SHIELDING_WARNING_TEXT}.`)
    expect(h.magnitude.method).toContain('Dose here: UNAVAILABLE')
    expect(h.magnitude.method).toContain('from 1.0 km to 2.0 km along the leg')
    expect(h.magnitude.method).toContain('highest sample, −1500 m')
    expect(h.magnitude.method).toContain('Heights: fixture DEM')
    expect(h.magnitude.method).toMatch(/not an agency limit/)
  })

  it('gives one hazard per separate climb', () => {
    const hazards = scan([-1800, -2500, -2500, -1600, -1700])
    expect(hazards.map((h) => h.coordinate)).toEqual([at(0), at(3)])
    expect(hazards.map((h) => h.id)).toEqual(['a-b-radiation-1', 'a-b-radiation-2'])
  })

  it('warns only above the line, where there is less air overhead', () => {
    expect(scan([WARN_M - 1, WARN_M - 0.5])).toEqual([])
    expect(scan([WARN_M + 1])).toHaveLength(1)
  })

  it('marks missing heights as not checked, so a leg with gaps is never all clear', () => {
    const hazards = scan([-2600, Number.NaN, Number.NaN, -2600])
    expect(hazards).toHaveLength(1)
    expect(hazards[0].coordinate).toEqual(at(1))
    expect(hazards[0].magnitude).toEqual(
      unavailable('No height from 500 m to 1.0 km along the leg, so the shielding there was not checked'),
    )
  })

  it('treats any height that is not finite as a gap, never as clear', () => {
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      expect(scan([-2600, bad, -2600]).map((h) => h.magnitude.classification)).toEqual(['UNAVAILABLE'])
    }
  })

  it('keeps climbs either side of a gap apart: warning, not checked, warning', () => {
    const hazards = scan([-1800, -1700, Number.NaN, -1600, -1650])
    expect(hazards.map((h) => h.magnitude.classification)).toEqual(['DERIVED', 'UNAVAILABLE', 'DERIVED'])
    expect(hazards.map((h) => h.coordinate)).toEqual([at(1), at(2), at(3)])
    expect(hazards.map((h) => h.id)).toEqual(['a-b-radiation-1', 'a-b-radiation-2', 'a-b-radiation-3'])
  })

  it('gives nothing for a leg with no samples', () => {
    expect(scan([])).toEqual([])
  })

  it('names the source of the highest sample, not of the others', () => {
    const [h] = legShieldingHazards(samples(3), [-1800, -1500, -1700], 'a-b', (i) => `model ${i}`)
    expect(h.magnitude.classification === 'DERIVED' && h.magnitude.method).toMatch(/Heights: model 1$/)
  })

  it('says a failed read left the shielding unchecked, with the read\'s own reason', () => {
    expect(shieldingNotChecked(at(0), 'a-b', 'the DEM did not load')).toEqual({
      id: 'a-b-radiation-1',
      kind: 'radiation',
      unit: RADIATION_HAZARD_UNIT,
      coordinate: at(0),
      magnitude: unavailable('The shielding was not checked: the DEM did not load'),
    })
  })
})

describe('walkLegs carries the radiation warning', () => {
  const stop = (id: string, lon: number): WalkStop => ({
    id,
    label: id,
    coordinate: { latitude: 18.44, longitudeEast: lon },
    unit: unavailable('fixture'),
    reason: derived('fixture', 'fixture'),
  })
  /** Heights rising from −2.5 km in the west to −1.5 km in the east of the fixture leg. */
  const climbing: WalkHeights = (points) => {
    const h = new Float32Array(points.length / 2)
    for (let i = 0; i < h.length; i++) h[i] = -2500 + ((points[i * 2 + 1] - 77.45) / 0.04) * 1000
    const models = [{ cellKm: 0.2, source: 'fixture DEM', site: false }]
    return Promise.resolve(official({ heights: h, model: new Uint8Array(h.length), models }, 'fixture DEM'))
  }

  it('adds a radiation hazard to a leg that climbs past the line, and says it scanned for it', async () => {
    const [leg] = await walkLegs(
      [stop('a', 77.45), stop('b', 77.49)],
      climbing,
      () => 0.2,
      official({ points: [], lines: [], areas: [] }, 'fixture map'),
      SUITED_SLOPE_LIMIT,
      new AbortController().signal,
    )
    expect(leg.hazards.classification).toBe('DERIVED')
    if (leg.hazards.classification !== 'DERIVED') return
    const radiation = leg.hazards.value.filter((h) => h.kind === 'radiation')
    expect(radiation).toHaveLength(1)
    // The highest sample is the leg's east end.
    expect(radiation[0].coordinate.longitudeEast).toBeCloseTo(77.49, 6)
    expect(leg.hazards.method).toMatch(/Each sample with a height checked for atmospheric shielding under 0\.8 of Gale's column/)
  })

  it('names the model that answered at the highest sample (CTX and the global model can differ by up to 72 m)', async () => {
    /** The global model answers only the leg's last sample, which is its highest. */
    const twoModels: WalkHeights = async (points, signal) => {
      const read = await climbing(points, signal)
      if (read.classification !== 'OFFICIAL') throw new Error('The fixture always reads')
      const model = new Uint8Array(read.value.heights.length)
      model[model.length - 1] = 1
      const models = [
        { cellKm: 0.2, source: 'fixture site model', site: true },
        { cellKm: 0.2, source: 'fixture global model', site: false },
      ]
      return official({ heights: read.value.heights, model, models }, 'fixture chain')
    }
    const [leg] = await walkLegs(
      [stop('a', 77.45), stop('b', 77.49)],
      twoModels,
      () => 0.2,
      official({ points: [], lines: [], areas: [] }, 'fixture map'),
      SUITED_SLOPE_LIMIT,
      new AbortController().signal,
    )
    if (leg.hazards.classification !== 'DERIVED') throw new Error('The leg should have a hazard list')
    const [radiation] = leg.hazards.value.filter((h) => h.kind === 'radiation')
    if (radiation.magnitude.classification !== 'DERIVED') throw new Error('The climb should have a figure')
    expect(radiation.magnitude.method).toMatch(/Heights: fixture global model$/)
    expect(radiation.magnitude.method).not.toContain('fixture chain')
    expect(radiation.magnitude.method).not.toContain('fixture site model')
  })
})
