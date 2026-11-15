import { describe, expect, it } from 'vitest'
import {
  SHIELDING_WARNING_TEXT,
  columnMassFraction,
  derived,
  isAvailable,
  official,
  simulated,
  unavailable,
  type HazardKind,
  type SurfacePoint,
} from '../../src/domain'
import {
  HAZARD_DETECTORS,
  HAZARD_REASONS,
  NO_HEIGHTS_FOR_SHIELDING,
  SCANNED_HAZARD_KINDS,
  UNSCANNED_HAZARD_KINDS,
  detectHazards,
  radiationDetector,
  slopeDetector,
  type HazardDetector,
} from '../../src/features/route-analysis/hazards'
import {
  NO_HEIGHTS_FOR_SLOPE,
  ROUTE_SLOPE_METHOD,
  SLOPE_HAZARD_UNIT,
  STEEP_SLOPE_FROM_DEG,
  slopeWarning,
} from '../../src/features/route-analysis/slopeHazard'

const ALL: HazardKind[] = ['slope', 'sudden-drop', 'dust', 'radiation', 'temperature', 'mapped-obstacle']
const READY: HazardKind[] = ['slope', 'radiation']
const STUBS = ALL.filter((k) => !READY.includes(k))

/** Builds route points from [latitude, longitudeEast] pairs, with no height. Test fixture only. */
function points(...coords: [number, number][]): SurfacePoint[] {
  return coords.map(([latitude, longitudeEast], i) => ({
    id: `p${i}`,
    coordinate: { latitude, longitudeEast },
    elevationMeters: unavailable('Not needed for hazards'),
  }))
}

/** Points along one parallel, 0.01° apart, at the given heights (NaN for none). Test fixture only. */
function heights(...metres: number[]): SurfacePoint[] {
  return metres.map((m, i) => ({
    id: `h${i}`,
    coordinate: { latitude: 18.44, longitudeEast: 77.45 + i * 0.01 },
    elevationMeters: Number.isFinite(m) ? official(m, 'fixture DEM') : unavailable('fixture gap'),
  }))
}

// Heights read from the Jezero CTX 20 m model on 2026-10-28: floor, delta, highest rim cell.
const JEZERO = { landingSite: -2567, deltaTop: -2483, highestCell: -1550 }

/** Fake detectors for testing how results combine — not real detection. */
function fakeDetectors(
  override: Partial<Record<HazardKind, HazardDetector['detect']>>,
): Record<HazardKind, HazardDetector> {
  const entries = ALL.map((kind) => [
    kind,
    { kind, requires: ['test'], ready: true, detect: override[kind] ?? (() => derived([], `${kind} test method`)) },
  ])
  return Object.fromEntries(entries) as Record<HazardKind, HazardDetector>
}

describe('hazard detectors', () => {
  it('has exactly one detector per HazardKind, keyed by its own kind', () => {
    expect(Object.keys(HAZARD_DETECTORS).sort()).toEqual([...ALL].sort())
    for (const kind of ALL) expect(HAZARD_DETECTORS[kind].kind).toBe(kind)
  })

  it.each(ALL)('%s states the data it requires', (kind) => {
    const { requires } = HAZARD_DETECTORS[kind]
    expect(requires.length).toBeGreaterThan(0)
    for (const r of requires) expect(r.length).toBeGreaterThan(0)
  })

  it.each(STUBS)('%s is an UNAVAILABLE stub, never an empty list, and says it is not ready', (kind) => {
    const result = HAZARD_DETECTORS[kind].detect(points([0, 10], [1, 11]))
    expect(result).toEqual({
      classification: 'UNAVAILABLE',
      reason: `${kind} detection not implemented`,
    })
    expect(HAZARD_DETECTORS[kind].ready).toBe(false)
  })

  it('slope and radiation are the ready detectors, and the lists say so', () => {
    expect(HAZARD_DETECTORS.radiation).toBe(radiationDetector)
    expect(HAZARD_DETECTORS.slope).toBe(slopeDetector)
    expect(radiationDetector.ready).toBe(true)
    expect(slopeDetector.ready).toBe(true)
    expect(SCANNED_HAZARD_KINDS).toEqual(READY)
    expect([...UNSCANNED_HAZARD_KINDS].sort()).toEqual([...STUBS].sort())
  })
})

describe('the radiation detector', () => {
  it('is UNAVAILABLE, not an empty list, when no point has a height', () => {
    expect(radiationDetector.detect(points([0, 10], [1, 11]))).toEqual(unavailable(NO_HEIGHTS_FOR_SHIELDING))
  })

  it('finds nothing on the Jezero floor and the delta, DERIVED with the method', () => {
    const result = radiationDetector.detect(heights(JEZERO.landingSite, JEZERO.deltaTop, JEZERO.landingSite))
    expect(result.classification).toBe('DERIVED')
    if (result.classification !== 'DERIVED') return
    expect(result.value).toEqual([])
    expect(result.method).toMatch(/0\.8 of Gale's column/)
    expect(result.method).toMatch(/scale height/i)
    // Shown in the Hazards panel: no tracker number a reader cannot look up.
    expect(result.method).not.toMatch(/#\d/)
  })

  it('flags the rim at its highest point, with the fraction there, worded along the route', () => {
    const result = radiationDetector.detect(heights(JEZERO.landingSite, -1900, JEZERO.highestCell, -1900, JEZERO.deltaTop))
    expect(result.classification).toBe('DERIVED')
    if (result.classification !== 'DERIVED') return
    expect(result.value).toHaveLength(1)
    const [h] = result.value
    expect(h.kind).toBe('radiation')
    expect(h.id).toBe('route-radiation-1')
    expect(h.coordinate).toEqual({ latitude: 18.44, longitudeEast: 77.47 })
    expect(isAvailable(h.magnitude)).toBe(true)
    if (!isAvailable(h.magnitude)) return
    expect(h.magnitude.value).toBeCloseTo(columnMassFraction(JEZERO.highestCell), 12)
    expect(h.magnitude.classification).toBe('DERIVED')
    if (h.magnitude.classification !== 'DERIVED') return
    expect(h.magnitude.method).toContain(SHIELDING_WARNING_TEXT)
    expect(h.magnitude.method).toMatch(/along the route/)
    expect(h.magnitude.method).not.toMatch(/along the leg/)
    expect(h.magnitude.method).toContain('Heights: fixture DEM')
  })

  it('a mixed route: a gap is "not checked", never silence, beside the rim hazard', () => {
    const result = radiationDetector.detect(heights(JEZERO.landingSite, Number.NaN, Number.NaN, JEZERO.highestCell))
    expect(result.classification).toBe('DERIVED')
    if (result.classification !== 'DERIVED') return
    expect(result.value.map((h) => h.magnitude.classification)).toEqual(['UNAVAILABLE', 'DERIVED'])
    expect(result.value[0].magnitude).toMatchObject({ reason: expect.stringMatching(/No height .* along the route, so the shielding there was not checked/) })
  })

  it('never states a dose', () => {
    const result = radiationDetector.detect(heights(JEZERO.highestCell))
    expect(JSON.stringify(result)).not.toMatch(/mSv|sievert|higher dose/i)
  })
})

describe('the slope detector', () => {
  /** Points along one parallel, `stepKm` apart, at the given heights. Test fixture only. */
  const KM_PER_DEG_LON = (Math.PI / 180) * 3389.5 * Math.cos((18.44 * Math.PI) / 180)
  const profile = (stepKm: number, ...metres: number[]): SurfacePoint[] =>
    metres.map((m, i) => ({
      id: `s${i}`,
      coordinate: { latitude: 18.44, longitudeEast: 77.45 + (i * stepKm) / KM_PER_DEG_LON },
      elevationMeters: Number.isFinite(m) ? official(m, 'fixture DEM') : unavailable('fixture gap'),
    }))
  /** The rise over 100 m of ground that is `deg` steep. */
  const rise = (deg: number) => 100 * Math.tan((deg * Math.PI) / 180)

  it('is UNAVAILABLE, not an empty list, when no stretch has a height at both ends', () => {
    expect(slopeDetector.detect(points([0, 10], [1, 11]))).toEqual(unavailable(NO_HEIGHTS_FOR_SLOPE))
    expect(slopeDetector.detect(profile(0.1, 0, Number.NaN, 0))).toEqual(unavailable(NO_HEIGHTS_FOR_SLOPE))
  })

  it('finds nothing on gentle and moderate ground, DERIVED with the method', () => {
    const result = slopeDetector.detect(profile(0.1, 0, rise(4), rise(4) + rise(14)))
    expect(result).toMatchObject({ classification: 'DERIVED', value: [] })
    if (result.classification !== 'DERIVED') return
    expect(result.method).toBe(ROUTE_SLOPE_METHOD)
    expect(result.method).toContain('EVA-EXP-0075')
    expect(result.method).toContain("project's own band")
  })

  it('warns from 15°, the steep band, uphill and downhill alike', () => {
    const up = slopeDetector.detect(profile(0.1, 0, rise(16)))
    const down = slopeDetector.detect(profile(0.1, rise(16), 0))
    for (const result of [up, down]) {
      if (result.classification !== 'DERIVED') throw new Error('expected a scan')
      expect(result.value).toHaveLength(1)
      const [h] = result.value
      expect(h).toMatchObject({ kind: 'slope', unit: SLOPE_HAZARD_UNIT, id: 'route-slope-1' })
      if (!isAvailable(h.magnitude)) throw new Error('expected a figure')
      expect(h.magnitude.value).toBeCloseTo(16, 1)
      expect(slopeWarning(h.magnitude.value)).toBe('steep')
    }
  })

  /** Points along one parallel with stretches of the given lengths (m) and slopes (°). Test fixture only. */
  const stretches = (...parts: [metres: number, deg: number][]): SurfacePoint[] => {
    let km = 0
    let height = 0
    const points = [{ km, height }]
    for (const [metres, deg] of parts) {
      km += metres / 1000
      height += metres * Math.tan((deg * Math.PI) / 180)
      points.push({ km, height })
    }
    return points.map((p, i) => ({
      id: `s${i}`,
      coordinate: { latitude: 18.44, longitudeEast: 77.45 + p.km / KM_PER_DEG_LON },
      elevationMeters: official(p.height, 'fixture DEM'),
    }))
  }
  const warnings = (points: SurfacePoint[]) => {
    const result = slopeDetector.detect(points)
    if (result.classification !== 'DERIVED') throw new Error('expected a scan')
    return result.value
  }

  it('keeps one warning over a single gentler stretch, however long, and says how much of the reach is steep', () => {
    const found = warnings(stretches([300, 16], [300, 0], [300, 18]))
    expect(found).toHaveLength(1)
    const [h] = found
    if (h.magnitude.classification !== 'DERIVED') throw new Error('expected a figure')
    expect(h.magnitude.value).toBeCloseTo(18, 1)
    expect(h.magnitude.method).toMatch(/^The steepest stretch of 600 m of steep ground in 900 m of the route starting 0 m along the route/)
  })

  it('counts the gentler ground afresh after each steep stretch', () => {
    // One short gentler stretch, steep again, then one long one: each gap is a single stretch.
    expect(warnings(stretches([20, 16], [20, 0], [20, 16], [300, 0], [20, 16]))).toHaveLength(1)
  })

  it('does not count a stretch of no length as gentler ground', () => {
    const points = stretches([20, 16], [300, 0], [20, 16])
    expect(warnings([points[0], points[1], { ...points[1], id: 'again' }, points[2], points[3]])).toHaveLength(1)
  })

  it('takes a stop written either side of 0°/360°E as one place, whatever the two heights given for it', () => {
    const stop = { latitude: 18.44, longitudeEast: 77.45 }
    const point = (id: string, coordinate: SurfacePoint['coordinate'], m: number): SurfacePoint => ({ id, coordinate, elevationMeters: official(m, 'fixture DEM') })
    const result = slopeDetector.detect([
      point('before', { latitude: 18.44, longitudeEast: 77.44 }, 0),
      point('stop, one leg', { ...stop, longitudeEast: stop.longitudeEast + 360 }, 0),
      point('stop, the next leg', stop, 2),
      point('after', { latitude: 18.44, longitudeEast: 77.46 }, 2),
    ])
    expect(result).toMatchObject({ classification: 'DERIVED', value: [] })
  })

  it('gives the steep ground and its reach in one unit', () => {
    const [h] = warnings(stretches([500, 16], [40, 0], [499.8, 16]))
    if (h.magnitude.classification !== 'DERIVED') throw new Error('expected a figure')
    expect(h.magnitude.method).toMatch(/^The steepest stretch of 1\.0 km of steep ground starting 0 m along the route/)
  })

  it('keeps one warning for a rough climb: steep steps with under 100 m of gentler ground between them', () => {
    // 20 m steps at 16° and 13° in turn, ending on a gentler one; three more make four together (80 m), then steep again.
    const heights = [0]
    const step = (deg: number) => heights.push(heights[heights.length - 1] + 20 * Math.tan((deg * Math.PI) / 180))
    for (let i = 0; i < 20; i++) step(i % 2 === 0 ? 16 : 13)
    for (let i = 0; i < 3; i++) step(13)
    step(16)
    const result = slopeDetector.detect(profile(0.02, ...heights))
    if (result.classification !== 'DERIVED') throw new Error('expected a scan')
    expect(result.value).toHaveLength(1)
  })

  it('parts the warnings where the gentler ground between them is over 100 m in several stretches', () => {
    // 120 m and 80 m, clear of the line either side: at 100 m itself the sum of the stretches decides.
    expect(warnings(stretches([20, 16], ...Array.from({ length: 6 }, (): [number, number] => [20, 13]), [20, 16]))).toHaveLength(2)
    expect(warnings(stretches([20, 16], ...Array.from({ length: 4 }, (): [number, number] => [20, 13]), [20, 16]))).toHaveLength(1)
  })

  it('ends a run at a stretch with no height: what lies past it is not known to be the same climb', () => {
    const result = slopeDetector.detect(profile(0.02, 0, rise(16) / 5, Number.NaN, rise(16) / 5, (2 * rise(16)) / 5))
    if (result.classification !== 'DERIVED') throw new Error('expected a scan')
    expect(result.value).toHaveLength(2)
  })

  it('joins neighbouring steep stretches into one warning, with the steepest figure at its middle', () => {
    const h = [0, rise(16), rise(16) + rise(24), rise(16) + rise(24) + rise(17)]
    // Two gentler stretches, 200 m of level ground, part the two warnings: one would not.
    const result = slopeDetector.detect(profile(0.1, ...h, h[3], h[3], h[3] + rise(18)))
    if (result.classification !== 'DERIVED') throw new Error('expected a scan')
    expect(result.value).toHaveLength(2)
    const [first, second] = result.value
    if (!isAvailable(first.magnitude) || !isAvailable(second.magnitude)) throw new Error('expected figures')
    expect(first.magnitude.value).toBeCloseTo(24, 1)
    expect(slopeWarning(first.magnitude.value)).toBe('over-limit')
    // The middle of the second stretch, 100–200 m along.
    expect(first.coordinate.longitudeEast).toBeCloseTo(77.45 + 0.15 / KM_PER_DEG_LON, 9)
    expect(first.magnitude.classification).toBe('DERIVED')
    if (first.magnitude.classification === 'DERIVED') expect(first.magnitude.method).toMatch(/^The steepest stretch of 300 m of steep ground starting 0 m along the route/)
    expect(second.magnitude.value).toBeCloseTo(18, 1)
  })

  it('does not check a stretch with no height at one end, and warns on neither side of it', () => {
    const result = slopeDetector.detect(profile(0.1, 0, Number.NaN, 500, 500))
    expect(result).toMatchObject({ classification: 'DERIVED', value: [] })
  })
})

describe('the steep slope rule', () => {
  it('has two lines, judged on the figure as shown', () => {
    expect(STEEP_SLOPE_FROM_DEG).toBe(15)
    expect(slopeWarning(14.94)).toBeNull()
    expect(slopeWarning(14.96)).toBe('steep')
    expect(slopeWarning(20)).toBe('steep')
    expect(slopeWarning(20.04)).toBe('steep')
    expect(slopeWarning(20.06)).toBe('over-limit')
    expect(slopeWarning(Number.NaN)).toBeNull()
    expect(slopeWarning(-3)).toBeNull()
  })
})

describe('detectHazards', () => {
  it('a route with no heights: UNAVAILABLE naming every detector that did not run, never []', () => {
    const result = detectHazards(points([0, 10], [1, 11], [2, 12]))
    expect(result.classification).toBe('UNAVAILABLE')
    if (result.classification !== 'UNAVAILABLE') return
    expect(result.reason).toMatch(new RegExp(`^${HAZARD_REASONS.nothingScanned}: `))
    for (const kind of STUBS) expect(result.reason).toContain(`${kind} (${kind} detection not implemented)`)
    expect(result.reason).toContain(`radiation (${NO_HEIGHTS_FOR_SHIELDING})`)
    expect(result.reason).toContain(`slope (${NO_HEIGHTS_FOR_SLOPE})`)
    expect(result).not.toHaveProperty('value')
  })

  it('a route with heights: DERIVED from the slope and radiation scans, and the method lists the kinds not scanned', () => {
    const result = detectHazards(heights(JEZERO.landingSite, JEZERO.highestCell))
    expect(result.classification).toBe('DERIVED')
    if (result.classification !== 'DERIVED') return
    // The fixture climbs a kilometre in half a kilometre: steep, and thin air at the top.
    expect(result.value.map((h) => h.kind)).toEqual(['slope', 'radiation'])
    expect(result.method).toMatch(/^Scanned for slope: /)
    expect(result.method).toContain('; radiation: ')
    expect(result.method).toContain('. Not scanned: ')
    for (const kind of STUBS) expect(result.method).toContain(`${kind} (${kind} detection not implemented)`)
  })

  it('a route on the crater floor: DERIVED and empty, "scanned, none", with the same coverage note', () => {
    const result = detectHazards(heights(JEZERO.landingSite, JEZERO.deltaTop))
    expect(result).toMatchObject({ classification: 'DERIVED', value: [] })
    if (result.classification === 'DERIVED') expect(result.method).toContain('Not scanned: sudden-drop')
  })

  it('is UNAVAILABLE for an empty route, with its own reason', () => {
    expect(detectHazards([])).toEqual({
      classification: 'UNAVAILABLE',
      reason: HAZARD_REASONS.empty,
    })
  })

  it('handles a single point and duplicate points without a height: nothing scanned', () => {
    for (const route of [points([4.5, 137.4]), points([4.5, 137.4], [4.5, 137.4])]) {
      const result = detectHazards(route)
      expect(result.classification).toBe('UNAVAILABLE')
      if (result.classification === 'UNAVAILABLE') expect(result.reason).toMatch(/^Nothing was scanned: /)
    }
  })

  it('handles duplicate points with a height: one hazard, not one per copy', () => {
    const result = detectHazards(heights(JEZERO.highestCell, JEZERO.highestCell))
    expect(result.classification).toBe('DERIVED')
    if (result.classification === 'DERIVED') expect(result.value).toHaveLength(1)
  })

  it('keeps the hazards the detectors that ran found, and names the one that did not with its reason', () => {
    const hazard = {
      id: 'h1',
      kind: 'slope' as const,
      coordinate: { latitude: 0, longitudeEast: 10 },
      magnitude: simulated(30, 'test fixture'),
      unit: 'deg',
    }
    const detectors = fakeDetectors({
      slope: () => derived([hazard], 'slope test method'),
      radiation: () => unavailable('no radiation data'),
    })
    const result = detectHazards(points([0, 10]), detectors)
    expect(result).toMatchObject({ classification: 'DERIVED', value: [hazard] })
    if (result.classification === 'DERIVED') {
      expect(result.method).toContain('slope: slope test method')
      expect(result.method).toContain('Not scanned: radiation (no radiation data)')
    }
  })

  it('is UNAVAILABLE with every reason when no detector ran', () => {
    const detectors = fakeDetectors(Object.fromEntries(ALL.map((k) => [k, () => unavailable(`${k} off`)])))
    const result = detectHazards(points([0, 10]), detectors)
    expect(result.classification).toBe('UNAVAILABLE')
    if (result.classification === 'UNAVAILABLE') {
      for (const kind of ALL) expect(result.reason).toContain(`${kind} (${kind} off)`)
    }
  })

  it('when every detector ran and found nothing, returns a DERIVED empty list with no "not scanned" note', () => {
    const result = detectHazards(points([0, 10]), fakeDetectors({}))
    expect(result.classification).toBe('DERIVED')
    if (result.classification === 'DERIVED') {
      expect(result.value).toEqual([])
      for (const kind of ALL) expect(result.method).toContain(`${kind}: ${kind} test method`)
      expect(result.method).not.toContain('Not scanned')
    }
  })

  it('when every detector ran, collects all hazards and cites each source', () => {
    // Radiation hazards carry a named unit; this fixture builds the free-unit kinds.
    const hazard = (kind: Exclude<HazardKind, 'radiation'>) => ({
      id: kind,
      kind,
      coordinate: { latitude: 0, longitudeEast: 10 },
      magnitude: unavailable<number>('test fixture'),
      unit: 'test',
    })
    const detectors = fakeDetectors({
      slope: () => derived([hazard('slope')], 'slope test method'),
      dust: () => simulated([hazard('dust')], 'dust test source'),
    })
    const result = detectHazards(points([0, 10]), detectors)
    expect(result.classification).toBe('DERIVED')
    if (result.classification === 'DERIVED') {
      expect(result.value.map((h) => h.kind).sort()).toEqual(['dust', 'slope'])
      expect(result.method).toContain('dust: dust test source')
    }
  })
})
