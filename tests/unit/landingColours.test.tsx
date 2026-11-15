import { readFileSync } from 'node:fs'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it } from 'vitest'
import { landingRatingAt, type LandingRatingRead, type LandingRatingState } from '../../src/app/landingRatingAt'
import { createLandingRatingStore, readLandingRating, type LandingRatingSources } from '../../src/app/landingRatingRead'
import { minimisedLegendMethod } from '../../src/features/mission-ui/walk/walkSteps'
import { MARS_MEAN_RADIUS_KM, derived, unavailable } from '../../src/domain'
import type { GeologicUnitArea, MarsCoordinate, SiteBounds } from '../../src/domain'
import { LANDING_COLOUR_ALPHA, LANDING_COLOUR_RGB, landingColourPixels } from '../../src/features/mars-3d/landingColourPixels'
import { LandingLegend, LandingLegendLine } from '../../src/features/mission-ui/walk/LandingLegend'
import {
  LANDING_LEGEND,
  LANDING_RATING,
  LANDING_REASON,
  LANDING_REASON_TEXT,
  landingReasonText,
} from '../../src/features/route-analysis/landingFavourability'
import {
  CRATER_INTERIOR_BASIS,
  CRATER_INTERIOR_LEGEND,
  CRATER_INTERIOR_UNITS,
  insideUnits,
  landingLattice,
  latticeCellAt,
} from '../../src/features/route-analysis/landingLattice'
import { useLandingColours } from '../../src/state'
import { SIM_3464_UNIT_NAMES } from '../fixtures/sim3464UnitNames'

// Test fixtures only: an invented box and invented polygons, never shown in the app.
const BOX: SiteBounds = { west: 77, east: 78, south: 18, north: 19 }
const ring = (w: number, e: number, s: number, n: number): MarsCoordinate[] => [
  { latitude: s, longitudeEast: w },
  { latitude: s, longitudeEast: e },
  { latitude: n, longitudeEast: e },
  { latitude: n, longitudeEast: w },
]
const area = (name: string, ...rings: MarsCoordinate[][]): GeologicUnitArea => ({
  unit: { name, symbol: 'x', map: { id: 'fixture map', citation: 'fixture' } } as GeologicUnitArea['unit'],
  rings,
})

describe('landing colour pixels', () => {
  it('draws green, yellow and red at one alpha and leaves a cell with no rating clear', () => {
    const px = landingColourPixels([0, 1, 2, 3])
    expect([...px.slice(0, 4)]).toEqual([0, 0, 0, 0])
    expect([...px.slice(4, 8)]).toEqual([...LANDING_COLOUR_RGB[1], LANDING_COLOUR_ALPHA])
    expect([...px.slice(8, 12)]).toEqual([...LANDING_COLOUR_RGB[2], LANDING_COLOUR_ALPHA])
    expect([...px.slice(12, 16)]).toEqual([...LANDING_COLOUR_RGB[3], LANDING_COLOUR_ALPHA])
  })

  it('draws nothing for a code it does not know', () => {
    expect([...landingColourPixels([4, 255, Number.NaN])]).toEqual(new Array(12).fill(0))
  })

  it('uses the same codes as the rating', () => {
    expect([LANDING_RATING.unavailable, LANDING_RATING.green, LANDING_RATING.yellow, LANDING_RATING.red]).toEqual([0, 1, 2, 3])
  })

  it('uses the slope bands’ hues of the design system, which the legend’s dots use', () => {
    const css = readFileSync(new URL('../../src/index.css', import.meta.url), 'utf8')
    const hex = (rgb: readonly number[]) => '#' + rgb.map((v) => v.toString(16).padStart(2, '0')).join('')
    expect(css).toContain(`--color-slope-gentle: ${hex(LANDING_COLOUR_RGB[1])};`)
    expect(css).toContain(`--color-slope-moderate: ${hex(LANDING_COLOUR_RGB[2])};`)
    expect(css).toContain(`--color-slope-steep: ${hex(LANDING_COLOUR_RGB[3])};`)
  })
})

describe('the landing lattice', () => {
  it('keeps at least the asked spacing both ways, even at the edge nearer the pole', () => {
    const lattice = landingLattice(BOX, 0.41)!
    expect(lattice.spacingNorthKm).toBeGreaterThanOrEqual(0.41)
    expect(lattice.spacingEastKm).toBeGreaterThanOrEqual(0.41)
    // One more column or row would break it.
    const kmPerDeg = (3389.5 * Math.PI) / 180
    expect((kmPerDeg * Math.cos((19 * Math.PI) / 180)) / (lattice.cols + 1)).toBeLessThan(0.41)
    expect(kmPerDeg / (lattice.rows + 1)).toBeLessThan(0.41)
    expect(lattice.points).toHaveLength(lattice.cols * lattice.rows * 2)
  })

  it('puts cell centres inside the box, rows north to south, each west to east', () => {
    const { cols, rows, points } = landingLattice(BOX, 10)!
    const at = (r: number, c: number) => ({ lat: points[(r * cols + c) * 2], lon: points[(r * cols + c) * 2 + 1] })
    expect(at(0, 0).lat).toBeGreaterThan(at(rows - 1, 0).lat)
    expect(at(0, 0).lon).toBeLessThan(at(0, cols - 1).lon)
    expect(at(0, 0).lat).toBeCloseTo(19 - 0.5 / rows, 9)
    expect(at(0, 0).lon).toBeCloseTo(77 + 0.5 / cols, 9)
    for (let k = 0; k < cols * rows; k++) {
      expect(points[k * 2]).toBeGreaterThan(18)
      expect(points[k * 2]).toBeLessThan(19)
      expect(points[k * 2 + 1]).toBeGreaterThan(77)
      expect(points[k * 2 + 1]).toBeLessThan(78)
    }
  })

  it('gives no lattice for a box too small, turned inside out, or by a pole', () => {
    expect(landingLattice(BOX, 30)).toBeNull()
    expect(landingLattice({ ...BOX, east: 76 }, 1)).toBeNull()
    expect(landingLattice({ west: 10, east: 11, south: 86, north: 87 }, 1)).toBeNull()
    expect(landingLattice(BOX, 0)).toBeNull()
  })

  it('finds the cell a point is in, and none outside the box', () => {
    expect(latticeCellAt(BOX, 4, 2, { latitude: 18.9, longitudeEast: 77.1 })).toBe(0)
    expect(latticeCellAt(BOX, 4, 2, { latitude: 18.1, longitudeEast: 77.9 })).toBe(7)
    expect(latticeCellAt(BOX, 4, 2, { latitude: 18, longitudeEast: 78 })).toBe(7)
    expect(latticeCellAt(BOX, 4, 2, { latitude: 19.1, longitudeEast: 77.5 })).toBeNull()
    expect(latticeCellAt(BOX, 4, 2, { latitude: 18.5, longitudeEast: 76.9 })).toBeNull()
  })
})

describe('inside the crater, from the map’s units', () => {
  const points = Float64Array.from([18.5, 77.25, 18.5, 77.75, 18.5, 77.5, 18.9, 77.9])

  it('names only units the map has, spelled as the map spells them', () => {
    const names = new Set(SIM_3464_UNIT_NAMES.map((u) => u.name))
    for (const name of CRATER_INTERIOR_UNITS) expect(names.has(name)).toBe(true)
    for (const name of CRATER_INTERIOR_UNITS) expect(CRATER_INTERIOR_BASIS).toContain(name)
    expect(CRATER_INTERIOR_BASIS).toContain('project reading')
  })

  it('flags a point in a polygon of a wanted unit, and not one in another unit or in none', () => {
    const areas = [area('Jezero floor unit', ring(77, 77.4, 18, 19)), area('Crater rim unit', ring(77.6, 78, 18, 18.7))]
    expect([...insideUnits(points, areas, CRATER_INTERIOR_UNITS)]).toEqual([1, 0, 0, 0])
  })

  it('cuts a polygon’s holes out', () => {
    const holed = area('Jezero floor unit', ring(77, 78, 18, 19), ring(77.4, 77.6, 18.4, 18.6))
    expect([...insideUnits(points, [holed], CRATER_INTERIOR_UNITS)]).toEqual([1, 1, 0, 1])
  })

  it('flags nothing with no polygons', () => {
    expect([...insideUnits(points, [], CRATER_INTERIOR_UNITS)]).toEqual([0, 0, 0, 0])
  })
})

describe('the landing colours store', () => {
  beforeEach(() => useLandingColours.getState().clearLandingColours())

  it('holds the grid to draw and clears it', () => {
    const grid = { bounds: BOX, cols: 2, rows: 1, rating: Uint8Array.from([1, 3]) }
    useLandingColours.getState().setLandingColours(grid)
    expect(useLandingColours.getState().grid).toBe(grid)
    useLandingColours.getState().clearLandingColours()
    expect(useLandingColours.getState().grid).toBeNull()
  })

  it('refuses a grid whose codes do not match its size', () => {
    useLandingColours.getState().setLandingColours({ bounds: BOX, cols: 2, rows: 2, rating: Uint8Array.from([1, 3]) })
    useLandingColours.getState().setLandingColours({ bounds: BOX, cols: 0, rows: 0, rating: new Uint8Array(0) })
    expect(useLandingColours.getState().grid).toBeNull()
  })
})

describe('the rating at the landing site', () => {
  const ready: LandingRatingState = {
    status: 'ready',
    grid: { bounds: BOX, cols: 2, rows: 1, rating: Uint8Array.from([LANDING_RATING.green, LANDING_RATING.unavailable]) },
    slopeDeg: Float32Array.from([1.5, Number.NaN]),
    reason: Uint8Array.from([LANDING_REASON.none, LANDING_REASON.seam]),
    method: 'fixture method',
  }
  const west: MarsCoordinate = { latitude: 18.5, longitudeEast: 77.2 }
  const east: MarsCoordinate = { latitude: 18.5, longitudeEast: 77.8 }

  it('gives the cell’s colour and slope, DERIVED with the method', () => {
    expect(landingRatingAt(ready, west)).toEqual({
      classification: 'DERIVED',
      value: { colour: 'green', slopeDeg: 1.5, cellKm: expect.closeTo(((BOX.north - BOX.south) * Math.PI * MARS_MEAN_RADIUS_KM) / 180, 6) },
      method: 'fixture method',
    })
  })

  it('says why a cell has no rating, never a colour', () => {
    expect(landingRatingAt(ready, east)).toEqual({ classification: 'UNAVAILABLE', reason: LANDING_REASON_TEXT[LANDING_REASON.seam] })
  })

  it('is unavailable outside the box, while reading, and after a failed read, with the reason', () => {
    expect(landingRatingAt(ready, { latitude: 20, longitudeEast: 77.2 }).classification).toBe('UNAVAILABLE')
    expect(landingRatingAt({ status: 'loading' }, west)).toEqual({ classification: 'UNAVAILABLE', reason: 'The landing rating is being read' })
    expect(landingRatingAt({ status: 'failed', reason: 'fixture failure' }, west)).toEqual({ classification: 'UNAVAILABLE', reason: 'fixture failure' })
  })

  it('has a text for every reason code and none for 0 or an unknown one', () => {
    for (const code of [1, 2, 3, 4, 5]) expect(landingReasonText(code)).toBeTruthy()
    expect(landingReasonText(0)).toBeNull()
    expect(landingReasonText(9)).toBeNull()
  })
})

describe('LandingLegend', () => {
  it('names the three colours with the rating’s own rules, what has no colour, and that it is not a safety statement', () => {
    const html = renderToStaticMarkup(<LandingLegend colours={{ status: 'ready', method: 'fixture method' }} />)
    for (const rule of [LANDING_LEGEND.green, LANDING_LEGEND.yellow, LANDING_LEGEND.red, LANDING_LEGEND.note]) expect(html).toContain(rule)
    for (const name of ['Green', 'Yellow', 'Red', 'No colour']) expect(html).toContain(`>${name}</span>`)
    expect(html).toContain('not a statement that a landing is safe')
    expect(html).toContain('project choices')
    expect(html).toContain('<span class="sr-only">DERIVED</span>')
    expect(html).toContain('fixture method')
  })

  it('says in a line on show what inside the crater means, since yellow covers flat ground inside the rim too', () => {
    const html = renderToStaticMarkup(<LandingLegend colours={{ status: 'ready', method: 'fixture method' }} />)
    expect(html).toContain(CRATER_INTERIOR_LEGEND)
    expect(CRATER_INTERIOR_LEGEND).toContain('Other ground inside the rim counts as outside')
  })

  it('keeps one line for the minimised panel: a project rating, not landing safety, with the method', () => {
    const html = renderToStaticMarkup(<LandingLegendLine method="fixture method" />)
    expect(html).toContain('not a statement that a landing is safe')
    expect(html).toContain('fixture method')
  })

  it('shows no swatches while the colours are being read, and says so', () => {
    const html = renderToStaticMarkup(<LandingLegend colours={{ status: 'loading' }} />)
    expect(html).toContain('role="status"')
    expect(html).toContain('Reading the heights and the geologic map')
    expect(html).not.toContain('Green')
  })

  it('says unavailable with the reason when they could not be read', () => {
    const html = renderToStaticMarkup(<LandingLegend colours={{ status: 'failed', reason: 'fixture failure' }} />)
    expect(html).toContain('unavailable')
    expect(html).toContain('fixture failure')
    expect(html).not.toContain('Green')
  })
})

describe('reading the landing rating', () => {
  const PLACE = { name: 'Fixture', bounds: { south: 18, north: 18.5, west: 77, east: 77.5 } }
  const MODELS = [
    { label: 'Fine fixture model', source: 'fixture', cellKm: 0.02, site: true },
    { label: 'Coarse fixture model', source: 'fixture', cellKm: 0.2, site: false },
  ]
  /** The fine model covers the west half; `fineAnswers` false is that model's read failing, the coarse one filling in. */
  const sources = (fineAnswers: boolean, hole = false): LandingRatingSources => ({
    elevationsAt: async (points) => {
      const n = points.length / 2
      const heights = new Float32Array(n).fill(-2500)
      const sourceIndex = new Uint8Array(n)
      for (let i = 0; i < n; i++) sourceIndex[i] = fineAnswers && points[i * 2 + 1] < 77.25 ? 0 : 1
      if (hole) heights[3] = NaN
      return derived({ heights, sourceIndex, sources: MODELS }, 'fixture heights')
    },
    unitAreas: async () => derived([], 'fixture map'),
    covers: [(_lat, lon) => lon < 77.25, () => true],
  })

  it('rates the lattice when every model that covers it answered', async () => {
    const read = await readLandingRating(PLACE, 0.41, sources(true))
    expect(typeof read).not.toBe('string')
    if (typeof read === 'string') return
    expect(read.grid.rating.length).toBe(read.grid.cols * read.grid.rows)
    expect(read.method).toContain('Horn')
  })

  it('refuses a read where a model that covers the ground gave nothing: the coarser model filled in and the answer only looks whole', async () => {
    const read = await readLandingRating(PLACE, 0.41, sources(false))
    expect(read).toBe('The heights could not be read from one of the elevation models (Fine fixture model)')
  })

  it('refuses a read with a cell that has no height, and says how many', async () => {
    expect(await readLandingRating(PLACE, 0.41, sources(true, true))).toMatch(/^The heights could not be read for 1 of \d+ cells$/)
  })

  it('passes on why the heights or the map could not be read', async () => {
    const noHeights = { ...sources(true), elevationsAt: async () => unavailable<never>('fixture outage') }
    expect(await readLandingRating(PLACE, 0.41, noHeights)).toBe('The heights could not be read: fixture outage')
    const noMap = { ...sources(true), unitAreas: async () => unavailable<never>('fixture map outage') }
    expect(await readLandingRating(PLACE, 0.41, noMap)).toBe('The geologic map could not be read: fixture map outage')
  })
})

describe('the landing rating kept for the visit', () => {
  const GOOD: LandingRatingRead = {
    grid: { bounds: BOX, cols: 1, rows: 1, rating: Uint8Array.from([1]) },
    slopeDeg: Float32Array.from([1]),
    reason: Uint8Array.from([0]),
    method: 'fixture method',
  }
  const settle = () => new Promise((r) => setTimeout(r, 0))

  it('reads once however often it is asked, and keeps a good read', async () => {
    let reads = 0
    const store = createLandingRatingStore(async () => (reads++, GOOD))
    store.ensure()
    store.ensure()
    expect(store.snapshot().status).toBe('loading')
    await settle()
    expect(store.snapshot()).toMatchObject({ status: 'ready', method: 'fixture method' })
    store.ensure()
    await settle()
    expect(reads).toBe(1)
  })

  it('does not keep a failed read: the next ask says loading, tries again and tells its listeners', async () => {
    const answers: (LandingRatingRead | string)[] = ['fixture failure', GOOD]
    const store = createLandingRatingStore(async () => answers.shift() ?? 'no more')
    const seen: string[] = []
    store.subscribe(() => seen.push(store.snapshot().status))
    store.ensure()
    await settle()
    expect(store.snapshot()).toEqual({ status: 'failed', reason: 'fixture failure' })
    store.ensure()
    expect(store.snapshot().status).toBe('loading')
    await settle()
    expect(store.snapshot().status).toBe('ready')
    expect(seen).toEqual(['failed', 'loading', 'ready'])
  })

  it('turns a thrown read into a failure, not a hang', async () => {
    const store = createLandingRatingStore(async () => {
      throw new Error('fixture throw')
    })
    store.ensure()
    await settle()
    expect(store.snapshot()).toEqual({ status: 'failed', reason: 'The landing rating failed: fixture throw' })
  })
})

describe('the legend line of the minimised panel', () => {
  const ready = { status: 'ready', method: 'fixture method' } as const
  it('shows only when minimised, on the landing step, with the colours drawn', () => {
    expect(minimisedLegendMethod(true, 'landing', ready)).toBe('fixture method')
    expect(minimisedLegendMethod(false, 'landing', ready)).toBeNull()
    expect(minimisedLegendMethod(true, 'settings', ready)).toBeNull()
    expect(minimisedLegendMethod(true, 'landing', { status: 'loading' })).toBeNull()
    expect(minimisedLegendMethod(true, 'landing', { status: 'failed' })).toBeNull()
    expect(minimisedLegendMethod(true, 'landing', undefined)).toBeNull()
  })
})
