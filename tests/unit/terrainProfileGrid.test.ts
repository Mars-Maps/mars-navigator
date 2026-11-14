import { describe, expect, it } from 'vitest'
import { derived, unavailable } from '../../src/domain'
import type { TerrainProfileCorners } from '../../src/features/route-analysis/terrainProfile'
import {
  gridPointPairs,
  insideQuadrilateral,
  TERRAIN_GRID_MAX_SIDE,
  TERRAIN_GRID_REASONS,
  terrainProfileGrid,
  terrainSurface,
  type SourcedGridHeights,
  type TerrainProfileGrid,
} from '../../src/features/route-analysis/terrainProfileGrid'
import { at, KM_PER_DEG_LAT, START } from './terrain.helpers'

// Test fixtures only: invented corners and heights near Jezero, never shown in the app.
const corners = (...pts: [number, number][]): TerrainProfileCorners => {
  const c = pts.map(([x, y]) => at(x, y))
  return [c[0], c[1], c[2], c[3]]
}
/** A 2 km square, first corner at the south-west, anticlockwise. */
const SQUARE = corners([0, 0], [2, 0], [2, 2], [0, 2])

const gridOf = (c: TerrainProfileCorners, cellKm = 0.5, maxSide?: number): TerrainProfileGrid => {
  const g = terrainProfileGrid(c, { cellKm, maxSide })
  if (g.classification !== 'DERIVED') throw new Error(`no grid: ${g.classification}`)
  return g.value
}
const NO_DATA = 'fixture: no height here'

describe('terrainProfileGrid: the frame', () => {
  it('puts the first corner at the origin and the others in km east and north of it', () => {
    const g = gridOf(SQUARE)
    expect(g.cornersKm[0]).toEqual({ x: 0, y: 0 })
    expect(g.cornersKm[1].x).toBeCloseTo(2, 3)
    expect(g.cornersKm[1].y).toBeCloseTo(0, 6)
    expect(g.cornersKm[2].x).toBeCloseTo(2, 3)
    expect(g.cornersKm[2].y).toBeCloseTo(2, 3)
    expect(g.sizeKm.x).toBeCloseTo(2, 3)
    expect(g.sizeKm.y).toBeCloseTo(2, 3)
  })

  it('keeps the box where it is when the first corner is the north-east one', () => {
    const g = gridOf(corners([2, 2], [0, 2], [0, 0], [2, 0]))
    expect(g.originKm.x).toBeCloseTo(-2, 3)
    expect(g.originKm.y).toBeCloseTo(-2, 3)
    // Row-major from the south-west: the first node is the box's south-west, the last its north-east.
    expect(g.nodes[0].xKm).toBeCloseTo(-2, 3)
    expect(g.nodes[0].yKm).toBeCloseTo(-2, 3)
    expect(g.nodes.at(-1)!.xKm).toBe(0)
    expect(g.nodes.at(-1)!.yKm).toBeCloseTo(0, 9)
  })

  it('nodes go west to east within a row and rows go northward; node coordinates round-trip the frame', () => {
    const g = gridOf(SQUARE)
    expect(g.nodes[1].xKm).toBeGreaterThan(g.nodes[0].xKm)
    expect(g.nodes[1].yKm).toBe(g.nodes[0].yKm)
    expect(g.nodes[g.columns].yKm).toBeGreaterThan(g.nodes[0].yKm)
    expect(g.nodes[g.columns].xKm).toBe(g.nodes[0].xKm)
    const ne = g.nodes.at(-1)!.coordinate
    expect(ne.latitude).toBeCloseTo(START.latitude + 2 / KM_PER_DEG_LAT, 6)
    expect(ne.longitudeEast).toBeCloseTo(SQUARE[2].longitudeEast, 4)
  })

  it('crosses 0°E the short way and keeps node longitudes in [0, 360)', () => {
    const c: TerrainProfileCorners = [
      { latitude: 0, longitudeEast: 359.9 },
      { latitude: 0, longitudeEast: 0.1 },
      { latitude: 0.2, longitudeEast: 0.1 },
      { latitude: 0.2, longitudeEast: 359.9 },
    ]
    const g = gridOf(c, 1)
    expect(g.sizeKm.x).toBeCloseTo(0.2 * KM_PER_DEG_LAT, 3)
    expect(g.cornersKm[1].x).toBeGreaterThan(0)
    for (const n of g.nodes) {
      expect(n.coordinate.longitudeEast).toBeGreaterThanOrEqual(0)
      expect(n.coordinate.longitudeEast).toBeLessThan(360)
    }
    const lons = g.nodes.slice(0, g.columns).map((n) => n.coordinate.longitudeEast)
    expect(lons[0]).toBeCloseTo(359.9, 6)
    expect(lons.at(-1)).toBeCloseTo(0.1, 6)
  })

  it('refuses four corners on one parallel: no area in the frame', () => {
    const c: TerrainProfileCorners = [at(0, 0), at(1, 0), at(2, 0), at(3, 0)]
    expect(terrainProfileGrid(c)).toEqual(unavailable(TERRAIN_GRID_REASONS.noArea))
  })
})

describe('terrainProfileGrid: spacing', () => {
  it('samples one node per cell of the elevation source', () => {
    const g = gridOf(SQUARE, 0.5)
    expect(g.columns).toBe(5)
    expect(g.rows).toBe(5)
    expect(g.spacingKm.x).toBeCloseTo(0.5, 3)
    expect(g.nodes).toHaveLength(25)
  })

  it('caps a large region at the side limit, thinned, never sharpened', () => {
    const g = gridOf(corners([0, 0], [100, 0], [100, 100], [0, 100]), 0.2)
    expect(g.columns).toBe(TERRAIN_GRID_MAX_SIDE)
    expect(g.rows).toBe(TERRAIN_GRID_MAX_SIDE)
    expect(g.spacingKm.x).toBeGreaterThan(2)
  })

  it('follows the box shape: a long thin box has many columns and two rows', () => {
    const g = gridOf(corners([0, 0], [10, 0], [10, 0.1], [0, 0.1]), 0.5)
    expect(g.columns).toBe(21)
    expect(g.rows).toBe(2)
  })

  it('takes the full side without a cell size, and never fewer than two a side', () => {
    expect(gridOf(SQUARE, 0).columns).toBe(TERRAIN_GRID_MAX_SIDE)
    expect(gridOf(SQUARE, 0, 1).columns).toBe(2)
  })

  it('states the lattice and the frame as its method', () => {
    const g = terrainProfileGrid(SQUARE, { cellKm: 0.5 })
    expect(g.classification).toBe('DERIVED')
    if (g.classification !== 'DERIVED') return
    expect(g.method).toContain('5 × 5 nodes')
    expect(g.method).toContain('500 m east')
    expect(g.method).toContain('km east and north of the first corner')
  })

  it('lists the nodes as (latitude, longitude) pairs in node order', () => {
    const g = gridOf(SQUARE)
    const pairs = gridPointPairs(g)
    expect(pairs).toHaveLength(g.nodes.length * 2)
    expect(pairs[0]).toBe(g.nodes[0].coordinate.latitude)
    expect(pairs[1]).toBe(g.nodes[0].coordinate.longitudeEast)
    expect(pairs[pairs.length - 1]).toBe(g.nodes.at(-1)!.coordinate.longitudeEast)
  })
})

describe('insideQuadrilateral', () => {
  const diamond = [
    { x: 1, y: 0 },
    { x: 2, y: 1 },
    { x: 1, y: 2 },
    { x: 0, y: 1 },
  ]
  it('marks the box corners outside a diamond and its centre and corners inside', () => {
    expect(insideQuadrilateral({ x: 0, y: 0 }, diamond)).toBe(false)
    expect(insideQuadrilateral({ x: 2, y: 2 }, diamond)).toBe(false)
    expect(insideQuadrilateral({ x: 1, y: 1 }, diamond)).toBe(true)
    for (const c of diamond) expect(insideQuadrilateral(c, diamond)).toBe(true)
    expect(insideQuadrilateral({ x: 0.5, y: 0.5 }, diamond)).toBe(true) // on an edge
  })

  it('takes a concave arrowhead: the notch is outside', () => {
    const arrow = [
      { x: 0, y: 0 },
      { x: 2, y: 1 },
      { x: 0.5, y: 1 },
      { x: 0, y: 2 },
    ]
    expect(insideQuadrilateral({ x: 0.2, y: 1 }, arrow)).toBe(true)
    expect(insideQuadrilateral({ x: 1.5, y: 1.5 }, arrow)).toBe(false)
    expect(insideQuadrilateral({ x: 1, y: 0.6 }, arrow)).toBe(true)
  })

  it('marks the grid nodes of a diamond region: the box corners outside, the middle inside', () => {
    const g = gridOf(corners([1, 0], [2, 1], [1, 2], [0, 1]), 0.5)
    expect(g.nodes[0].inside).toBe(false)
    expect(g.nodes.at(-1)!.inside).toBe(false)
    expect(g.nodes[2 * g.columns + 2].inside).toBe(true)
    expect(g.nodes.filter((n) => n.inside).length).toBe(13)
  })
})

describe('terrainSurface', () => {
  const grid = terrainProfileGrid(SQUARE, { cellKm: 1 }) // 3 × 3
  const MODELS = [
    { label: 'fixture 1 m', source: 'fixture 1 m model, nearest cell (fixture)', cellKm: 0.001 },
    { label: 'fixture 200 m', source: 'fixture 200 m model, nearest cell (fixture)', cellKm: 0.2 },
  ]
  const read = (heights: number[], sourceIndex = heights.map(() => 0)): SourcedGridHeights => ({
    heights: Float32Array.from(heights),
    sourceIndex: Uint8Array.from(sourceIndex),
    sources: MODELS,
  })

  it('pairs heights with nodes, keeps holes as NaN and counts them, and reports the range and the models', () => {
    const heights = [-2500, -2490, Number.NaN, -2480, -2470, -2460, -2450, -2440, -2430]
    const s = terrainSurface(grid, derived(read(heights, [0, 0, 0, 0, 1, 1, 1, 1, 1]), 'fixture'), NO_DATA)
    expect(s.classification).toBe('DERIVED')
    if (s.classification !== 'DERIVED') return
    expect(Number.isNaN(s.value.heightsM[2])).toBe(true)
    expect(s.value.holes).toBe(1)
    expect(s.value.rangeM).toEqual({ min: -2500, max: -2430 })
    expect(s.value.shares).toEqual([
      { model: MODELS[0], count: 3 },
      { model: MODELS[1], count: 5 },
    ])
    expect(s.method).toContain('3 × 3 nodes')
    expect(s.method).toContain('3 from the fixture 1 m, 5 from the fixture 200 m')
    expect(s.method).toContain('1 node has no height')
    expect(s.method).toContain('. Sources: fixture 1 m model, nearest cell (fixture); fixture 200 m model, nearest cell (fixture)')
  })

  it('leaves out models that gave nothing', () => {
    const s = terrainSurface(grid, derived(read(new Array<number>(9).fill(10)), 'fixture'), NO_DATA)
    if (s.classification !== 'DERIVED') throw new Error(s.classification)
    expect(s.value.shares).toEqual([{ model: MODELS[0], count: 9 }])
    expect(s.method).not.toContain('holes')
  })

  it('refuses a read of the wrong length rather than misaligning it', () => {
    const s = terrainSurface(grid, derived(read([1, 2, 3]), 'fixture'), NO_DATA)
    expect(s).toEqual(unavailable('The elevation source answered 3 heights for 9 nodes'))
  })

  it('is UNAVAILABLE with the no-data reason when every node is a hole', () => {
    const s = terrainSurface(grid, derived(read(new Array<number>(9).fill(Number.NaN)), 'fixture'), NO_DATA)
    expect(s).toEqual(unavailable(NO_DATA))
  })

  it('passes an UNAVAILABLE grid or read through with its reason', () => {
    expect(terrainSurface(unavailable('no grid'), derived(read([1]), 'fixture'), NO_DATA)).toEqual(unavailable('no grid'))
    expect(terrainSurface(grid, unavailable('Cancelled'), NO_DATA)).toEqual(unavailable('Cancelled'))
  })
})
