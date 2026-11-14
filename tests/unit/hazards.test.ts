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
  type HazardDetector,
} from '../../src/features/route-analysis/hazards'

const ALL: HazardKind[] = ['slope', 'sudden-drop', 'dust', 'radiation', 'temperature', 'mapped-obstacle']
const STUBS = ALL.filter((k) => k !== 'radiation')

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

  it('radiation is the one ready detector, and the lists say so', () => {
    expect(HAZARD_DETECTORS.radiation).toBe(radiationDetector)
    expect(radiationDetector.ready).toBe(true)
    expect(SCANNED_HAZARD_KINDS).toEqual(['radiation'])
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

describe('detectHazards', () => {
  it('a route with no heights: UNAVAILABLE naming every detector that did not run, never []', () => {
    const result = detectHazards(points([0, 10], [1, 11], [2, 12]))
    expect(result.classification).toBe('UNAVAILABLE')
    if (result.classification !== 'UNAVAILABLE') return
    expect(result.reason).toMatch(new RegExp(`^${HAZARD_REASONS.nothingScanned}: `))
    for (const kind of STUBS) expect(result.reason).toContain(`${kind} (${kind} detection not implemented)`)
    expect(result.reason).toContain(`radiation (${NO_HEIGHTS_FOR_SHIELDING})`)
    expect(result).not.toHaveProperty('value')
  })

  it('a route with heights: DERIVED from the radiation scan alone, and the method lists the kinds not scanned', () => {
    const result = detectHazards(heights(JEZERO.landingSite, JEZERO.highestCell))
    expect(result.classification).toBe('DERIVED')
    if (result.classification !== 'DERIVED') return
    expect(result.value.map((h) => h.kind)).toEqual(['radiation'])
    expect(result.method).toMatch(/^Scanned for radiation: /)
    expect(result.method).toContain('. Not scanned: ')
    for (const kind of STUBS) expect(result.method).toContain(`${kind} (${kind} detection not implemented)`)
  })

  it('a route on the crater floor: DERIVED and empty, "scanned, none", with the same coverage note', () => {
    const result = detectHazards(heights(JEZERO.landingSite, JEZERO.deltaTop))
    expect(result).toMatchObject({ classification: 'DERIVED', value: [] })
    if (result.classification === 'DERIVED') expect(result.method).toContain('Not scanned: slope')
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
