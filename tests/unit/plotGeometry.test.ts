import { describe, expect, it } from 'vitest'
import { derived } from '../../src/domain'
import {
  axisTicks,
  cameraStart,
  EXAGGERATIONS,
  frameSegments,
  HEIGHT_RAMP,
  heightfieldArrays,
  nearestNode,
  plotAnchors,
  rampColor,
  verticalExaggeration,
} from '../../src/features/mars-3d/terrainProfile/plotGeometry'
import type { TerrainProfileCorners } from '../../src/features/route-analysis/terrainProfile'
import { terrainProfileGrid, terrainSurface, type TerrainSurface } from '../../src/features/route-analysis/terrainProfileGrid'
import { at } from './terrain.helpers'

// Test fixtures only: an invented 2 km square and heights, never shown in the app.
const SQUARE: TerrainProfileCorners = [at(0, 0), at(2, 0), at(2, 2), at(0, 2)]
const MODEL = { label: 'fixture', source: 'fixture model', cellKm: 1 }

/** A 3 × 3 surface with the given heights (row-major from the south-west). */
function surfaceOf(heights: number[]): TerrainSurface {
  const grid = terrainProfileGrid(SQUARE, { cellKm: 1 })
  const s = terrainSurface(
    grid,
    derived({ heights: Float32Array.from(heights), sourceIndex: new Uint8Array(9), sources: [MODEL] }, 'fixture'),
    'no data',
  )
  if (s.classification !== 'DERIVED') throw new Error(s.classification)
  return s.value
}
const RISING = surfaceOf([0, 10, 20, 30, 40, 50, 60, 70, 80])

describe('verticalExaggeration', () => {
  it('is ×1 for flat ground and for relief already a good share of the box', () => {
    expect(verticalExaggeration({ x: 2, y: 2 }, 0)).toBe(1)
    expect(verticalExaggeration({ x: 2, y: 2 }, 500)).toBe(1)
    expect(verticalExaggeration({ x: 2, y: 2 }, 5000)).toBe(1) // never flattened
  })

  it('stretches small relief up to about a third of the longer side, by round steps only', () => {
    // 2 km box, 30 m relief: target 0.6 km; ×20 gives 0.6 km, ×50 would be 1.5 km.
    expect(verticalExaggeration({ x: 2, y: 1 }, 30)).toBe(20)
    expect(verticalExaggeration({ x: 1, y: 2 }, 30)).toBe(20)
    expect(verticalExaggeration({ x: 10, y: 10 }, 10)).toBe(100)
    for (const r of [1, 7, 33, 120, 900]) expect(EXAGGERATIONS).toContain(verticalExaggeration({ x: 3, y: 3 }, r))
  })
})

describe('heightfieldArrays', () => {
  it('puts each node at (x east, exaggerated height above the lowest, −y north) in km', () => {
    const a = heightfieldArrays(RISING, 10)
    expect(a.positions).toHaveLength(27)
    expect(a.positions[0]).toBeCloseTo(0, 6) // first node: south-west, lowest
    expect(a.positions[1]).toBe(0)
    expect(a.positions[2]).toBeCloseTo(0, 6)
    // The north-east node, 80 m up, ×10 → 0.8 km, at x = 2, z = −2.
    expect(a.positions[24]).toBeCloseTo(2, 2)
    expect(a.positions[25]).toBeCloseTo(0.8, 6)
    expect(a.positions[26]).toBeCloseTo(-2, 2)
    expect(a.heightKm).toBeCloseTo(0.8, 6)
  })

  it('draws two triangles per cell, all counter-clockwise seen from above', () => {
    const a = heightfieldArrays(RISING, 1)
    expect(a.indices).toHaveLength(4 * 2 * 3)
    for (let t = 0; t < a.indices.length; t += 3) {
      const [i, j, k] = [a.indices[t], a.indices[t + 1], a.indices[t + 2]]
      const p = (n: number) => [a.positions[n * 3], a.positions[n * 3 + 2]] // x, z
      const [ax, az] = p(i)
      const [bx, bz] = p(j)
      const [cx, cz] = p(k)
      // In the x–z plane seen from +y, counter-clockwise has a negative cross product (z points south).
      expect((bx - ax) * (cz - az) - (bz - az) * (cx - ax)).toBeLessThan(0)
    }
  })

  it('leaves a hole out of every triangle, and never at a depth', () => {
    const holed = surfaceOf([0, 10, 20, 30, Number.NaN, 50, 60, 70, 80])
    const a = heightfieldArrays(holed, 1)
    // The centre node touches all four cells: six of the eight triangles go.
    expect(a.indices).toHaveLength(2 * 3)
    expect(Array.from(a.indices)).not.toContain(4)
    expect(a.positions[4 * 3 + 1]).toBe(0)
    expect(Number.isNaN(a.positions[4 * 3 + 1])).toBe(false)
  })

  it('colours by height, dark blue lowest to red highest, inside the quadrilateral and dims the nodes outside it', () => {
    const a = heightfieldArrays(RISING, 1)
    expect(a.colors).toHaveLength(27)
    // The lowest node is blue (blue over red), the highest red (red over blue), the middle neither.
    expect(a.colors[2]).toBeGreaterThan(a.colors[0])
    expect(a.colors[24]).toBeGreaterThan(a.colors[26])
    expect(rampColor(0)).toEqual(HEIGHT_RAMP[0])
    expect(rampColor(1)).toEqual(HEIGHT_RAMP[HEIGHT_RAMP.length - 1])
    expect(rampColor(0.5)[1]).toBeGreaterThan(rampColor(0)[1]) // greener in the middle
    const diamond: TerrainProfileCorners = [at(1, 0), at(2, 1), at(1, 2), at(0, 1)]
    const grid = terrainProfileGrid(diamond, { cellKm: 1 })
    const s = terrainSurface(grid, derived({ heights: new Float32Array(9).fill(5), sourceIndex: new Uint8Array(9), sources: [MODEL] }, 'f'), 'no data')
    if (s.classification !== 'DERIVED') throw new Error(s.classification)
    const b = heightfieldArrays(s.value, 1)
    // The south-west box corner is outside the diamond: pulled toward the canvas colour, unlike the centre, which is inside.
    const fromCanvas = (i: number) => Math.abs(b.colors[i] - 0.07) + Math.abs(b.colors[i + 1] - 0.075) + Math.abs(b.colors[i + 2] - 0.085)
    expect(fromCanvas(0)).toBeLessThan(fromCanvas(4 * 3) * 0.5)
  })
})

describe('axisTicks', () => {
  it('gives round ticks, 2 to 6 of them, labelled without trailing zeros', () => {
    expect(axisTicks(0, 2)).toEqual([
      { at: 0, label: '0' },
      { at: 0.5, label: '0.5' },
      { at: 1, label: '1' },
      { at: 1.5, label: '1.5' },
      { at: 2, label: '2' },
    ])
    expect(axisTicks(-2, 0).map((t) => t.label)).toEqual(['-2', '-1.5', '-1', '-0.5', '0'])
    expect(axisTicks(-2540, -2460, 5).map((t) => t.at)).toEqual([-2540, -2520, -2500, -2480, -2460])
    // Corners a few tens of metres apart still get round ticks, down to 10 m.
    expect(axisTicks(0, 0.05).map((t) => t.label)).toEqual(['0', '0.01', '0.02', '0.03', '0.04', '0.05'])
    expect(axisTicks(0, 47).length).toBeLessThanOrEqual(6)
    expect(axisTicks(0, 47).length).toBeGreaterThanOrEqual(2)
  })

  it('is empty for no span', () => {
    expect(axisTicks(3, 3)).toEqual([])
  })
})

describe('frame, anchors and camera', () => {
  it('frames the floor, raises the height axis at the south-west corner and marks every tick outward', () => {
    const f = frameSegments(RISING, 0.8)
    // Four floor edges, the axis, 4 x ticks, 5 y ticks, the lowest and highest heights.
    expect(f).toHaveLength((5 + 4 + 5 + 2) * 2 * 3)
    // The fifth segment: from the south-west corner on the floor straight up.
    expect(f.slice(24, 30)[1]).toBe(0)
    expect(f.slice(24, 30)[4]).toBeCloseTo(0.8, 6)
    expect(f[24]).toBe(f[27])
    expect(f[26]).toBe(f[29])
    // The first x tick mark points south (+z) off the south edge; the first y tick east (+x) off the east edge.
    const xTick = f.slice(30, 36)
    expect(xTick[5]).toBeGreaterThan(xTick[2])
    expect(xTick[3]).toBe(xTick[0])
    const yTick = f.slice(30 + 4 * 6, 36 + 4 * 6)
    expect(yTick[3]).toBeGreaterThan(yTick[0])
    // Flat ground gets one height mark, not two on top of each other.
    expect(frameSegments(RISING, 0)).toHaveLength((5 + 4 + 5 + 1) * 2 * 3)
  })

  it('anchors ticks past their marks, the true height extremes, the corners just outside and the axes with the exaggeration', () => {
    const a = plotAnchors(RISING, 10, 0.8)
    // The fixture's box is a hair under 2 km (east is scaled by the box's middle latitude), so the 2 km tick is past its edge.
    const xs = a.filter((x) => x.kind === 'x')
    expect(xs.map((x) => x.text)).toEqual(['0', '0.5', '1', '1.5'])
    expect(xs[0].z).toBeGreaterThan(0) // south of the south edge, at the tick's end
    const ys = a.filter((x) => x.kind === 'y')
    expect(ys.map((x) => x.text)).toEqual(['0', '0.5', '1', '1.5', '2'])
    expect(ys[0].x).toBeGreaterThan(RISING.grid.sizeKm.x)
    expect(a.find((x) => x.kind === 'zlow')).toMatchObject({ y: 0, text: '0 m' })
    expect(a.find((x) => x.kind === 'zhigh')).toMatchObject({ y: 0.8, text: '80 m' })
    const corners = a.filter((x) => x.kind === 'corner')
    expect(corners.map((x) => x.text)).toEqual(['1', '2', '3', '4'])
    expect(corners[0].y).toBe(0) // the first corner is the lowest node
    expect(corners[0].x).toBeLessThan(0) // nudged outward from the south-west corner
    expect(corners[0].z).toBeGreaterThan(0)
    expect(corners[2].y).toBeCloseTo(0.8, 6) // the third, the north-east, the highest
    expect(a.find((x) => x.kind === 'axis' && x.text.startsWith('z'))?.text).toBe('z, m (×10)')
    // Flat ground: one height label, at the floor.
    const flat = surfaceOf(new Array<number>(9).fill(-2000))
    expect(plotAnchors(flat, 1, 0).filter((x) => x.kind.startsWith('z')).map((x) => x.text)).toEqual(['-2,000 m'])
  })

  it('finds the node nearest a frame point, clamped to the lattice', () => {
    expect(nearestNode(RISING, { x: 0, y: 0 })).toBe(0)
    expect(nearestNode(RISING, { x: 2, y: 2 })).toBe(8)
    expect(nearestNode(RISING, { x: 1.1, y: 0.9 })).toBe(4)
    expect(nearestNode(RISING, { x: 99, y: -99 })).toBe(2)
  })

  it('starts the camera south-east of and above the box, aimed at its middle', () => {
    const c = cameraStart(RISING, 0.8, 40)
    expect(c.target[0]).toBeCloseTo(1, 2)
    expect(c.target[1]).toBeCloseTo(0.4, 6)
    expect(c.target[2]).toBeCloseTo(-1, 2)
    expect(c.position[0]).toBeGreaterThan(c.target[0])
    expect(c.position[1]).toBeGreaterThan(c.target[1])
    expect(c.position[2]).toBeGreaterThan(c.target[2])
  })
})
