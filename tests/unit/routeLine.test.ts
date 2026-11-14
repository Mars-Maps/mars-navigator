import { describe, expect, it } from 'vitest'
import { derived } from '../../src/domain'
import { heightAt, ribbon, routeLines, routeOnSurface } from '../../src/features/mars-3d/terrainProfile/routeLine'
import type { TerrainProfileCorners } from '../../src/features/route-analysis/terrainProfile'
import { terrainProfileGrid, terrainSurface, type TerrainSurface } from '../../src/features/route-analysis/terrainProfileGrid'
import { at } from './terrain.helpers'

// Test fixtures only: an invented 2 km square and heights, never shown in the app.
const SQUARE: TerrainProfileCorners = [at(0, 0), at(2, 0), at(2, 2), at(0, 2)]
const MODEL = { label: 'fixture', source: 'fixture model', cellKm: 1 }

/** A 3 × 3 surface, 1 km spacing, with the given heights (row-major from the south-west). */
function surfaceOf(heights: number[]): TerrainSurface {
  const s = terrainSurface(
    terrainProfileGrid(SQUARE, { cellKm: 1 }),
    derived({ heights: Float32Array.from(heights), sourceIndex: new Uint8Array(9), sources: [MODEL] }, 'fixture'),
    'no data',
  )
  if (s.classification !== 'DERIVED') throw new Error(s.classification)
  return s.value
}
const RISING = surfaceOf([0, 10, 20, 30, 40, 50, 60, 70, 80])
const HOLED = surfaceOf([Number.NaN, 10, 20, 30, 40, 50, 60, 70, 80])
/** Every cell twisted: the sw–ne diagonal's nodes 10, the others 0. */
const TWISTED = surfaceOf([10, 0, 10, 0, 10, 0, 10, 0, 10])
/** The line's lift above the ground, plot km: 0.6 % of the 2 km box. */
const LIFT = 0.012

// The fixture's km are measured at the first corner's latitude, the grid's at the box's middle: the same to a few parts in 10⁵.
describe('heightAt', () => {
  it('reads a node exactly and interpolates linearly on the mesh\'s own triangle', () => {
    expect(heightAt(RISING, { x: 1, y: 1 })).toBeCloseTo(40, 2)
    expect(heightAt(RISING, { x: 0.5, y: 0 })).toBeCloseTo(5, 2)
    expect(heightAt(RISING, { x: 0.5, y: 0.5 })).toBeCloseTo(20, 2) // on the diagonal, the mean of 0 and 40
    // Rising ground is planar, so both triangles agree; a twisted cell tells them apart.
    expect(heightAt(TWISTED, { x: 0.5, y: 0.5 })).toBeCloseTo(10, 2) // on the diagonal: 10 at both ends
    expect(heightAt(TWISTED, { x: 0.75, y: 0.25 })).toBeCloseTo(5, 2) // sw–se–ne: 10 + (0 − 10)·0.75 + (10 − 0)·0.25
    expect(heightAt(TWISTED, { x: 0.25, y: 0.75 })).toBeCloseTo(5, 2) // sw–ne–nw: 10 + (0 − 10)·0.75 + (10 − 0)·0.25
    expect(heightAt(TWISTED, { x: 0.5, y: 0.25 })).toBeCloseTo(7.5, 2) // bilinear would say 5
    const { originKm: o, sizeKm: size } = RISING.grid
    expect(heightAt(RISING, { x: o.x + size.x, y: o.y + size.y })).toBeCloseTo(80, 2) // the far edge reads the last cell
  })

  it('is NaN outside the box and on a triangle with a hole at a node, as the mesh has none there', () => {
    expect(heightAt(RISING, { x: -0.1, y: 1 })).toBeNaN()
    expect(heightAt(RISING, { x: 1, y: 2.1 })).toBeNaN()
    expect(heightAt(HOLED, { x: 0.5, y: 0.5 })).toBeNaN() // the hole is the south-west node, on both triangles
    expect(heightAt(HOLED, { x: 1.5, y: 0.5 })).toBeCloseTo(30, 2) // the cell east of the hole is whole
    // A hole at the north-west node only takes the north-west triangle; the south-east one is drawn and read.
    const nwHole = surfaceOf([0, 10, 20, Number.NaN, 40, 50, 60, 70, 80])
    expect(heightAt(nwHole, { x: 0.75, y: 0.25 })).toBeCloseTo(15, 2)
    expect(heightAt(nwHole, { x: 0.25, y: 0.75 })).toBeNaN()
    expect(heightAt(nwHole, { x: 0.5, y: 0.5 })).toBeCloseTo(20, 2) // the diagonal is drawn by the whole triangle
  })
})

describe('routeLines', () => {
  it('follows the ground along the route, resampled at half the spacing, exaggerated and lifted, z south', () => {
    const lines = routeLines(RISING, [at(0.5, 0.5), at(1.5, 0.5)], 10)
    // Samples at x = 0.5, 1, 1.5: one line of three vertices.
    expect(lines).toHaveLength(1)
    expect(lines[0]).toHaveLength(3)
    const [a, b, c] = lines[0]
    expect(a[0]).toBeCloseTo(0.5, 3)
    expect(a[1]).toBeCloseTo(0.2 + LIFT, 3) // 20 m ×10 = 0.2 km, plus the lift
    expect(a[2]).toBeCloseTo(-0.5, 3)
    expect(b[0]).toBeCloseTo(1, 3)
    expect(b[1]).toBeCloseTo(0.25 + LIFT, 3) // 25 m between the 10 and 40 m nodes
    expect(c[0]).toBeCloseTo(1.5, 3)
  })

  it('draws only the part of the route inside the box', () => {
    const [line] = routeLines(RISING, [at(-1, 1), at(3, 1)], 1)
    const xs = line.map((v) => v[0])
    expect(Math.min(...xs)).toBeCloseTo(0, 3)
    expect(Math.max(...xs)).toBeCloseTo(2, 3)
  })

  it('breaks the line over a hole rather than drawing a height there', () => {
    const lines = routeLines(HOLED, [at(0.25, 0.25), at(1.75, 0.25)], 1)
    // Samples at x = 0.25, 0.75 sit in the holed cell and are dropped; 1.25 and 1.75 make one line.
    expect(lines).toHaveLength(1)
    expect(lines[0].map((v) => +v[0].toFixed(3))).toEqual([1.25, 1.75])
  })

  it('is empty for a route that never crosses the box, or one of a single point', () => {
    expect(routeLines(RISING, [at(-1, -1), at(-1, 3)], 1)).toEqual([])
    expect(routeLines(RISING, [at(1, 1)], 1)).toEqual([])
  })

  it('routeOnSurface says whether anything would be drawn: a crossing only over holes is not', () => {
    expect(routeOnSurface(RISING, [at(-1, 1), at(3, 1)])).toBe(true)
    expect(routeOnSurface(RISING, [at(-1, -1), at(-1, 3)])).toBe(false)
    expect(routeOnSurface(HOLED, [at(0.1, 0.1), at(0.4, 0.4)])).toBe(false)
  })
})

describe('ribbon', () => {
  it('lays two vertices per sample either side of the line, across its direction, and two triangles per step', () => {
    const r = ribbon([[[0, 1, 0], [1, 1, 0], [2, 1, 0]]], 0.2)
    expect(r.positions).toHaveLength(18)
    expect(r.indices).toHaveLength(12)
    // Along x, the offset is across z, 0.1 either side, at the line's height (Float32, so to six places).
    const near = (got: Float32Array, want: number[]) => Array.from(got).forEach((v, i) => expect(v).toBeCloseTo(want[i], 6))
    near(r.positions.slice(0, 6), [0, 1, 0.1, 0, 1, -0.1])
    near(r.positions.slice(12, 18), [2, 1, 0.1, 2, 1, -0.1])
    expect(Array.from(r.indices)).toEqual([0, 1, 2, 1, 3, 2, 2, 3, 4, 3, 5, 4])
  })

  it('at a bend offsets across the mean direction, and a drop lowers the whole ribbon', () => {
    const r = ribbon([[[0, 1, 0], [1, 1, 0], [1, 1, -1]]], 0.2, 0.05)
    // The middle sample: direction (1, −1)/√2 in the floor, across it (1, 1)/√2 · 0.1.
    expect(r.positions[6]).toBeCloseTo(1 + 0.1 / Math.SQRT2, 6)
    expect(r.positions[8]).toBeCloseTo(0.1 / Math.SQRT2, 6)
    expect(r.positions[7]).toBeCloseTo(0.95, 6)
    // Doubling back: the middle sample keeps its width across the step before, no bow-tie.
    const back = ribbon([[[0, 0, 0], [1, 0, 0], [0, 0, 0]]], 0.2)
    expect(back.positions[6]).toBeCloseTo(1, 6)
    expect(back.positions[8]).toBeCloseTo(0.1, 6)
    expect(back.positions[11]).toBeCloseTo(-0.1, 6)
    expect(back.positions[14]).toBeCloseTo(0.1, 6) // the last pair, across the same line, same side first
    // Two lines: indices never bridge them.
    const two = ribbon([[[0, 0, 0], [1, 0, 0]], [[5, 0, 0], [6, 0, 0]]], 0.1)
    expect(Array.from(two.indices)).toEqual([0, 1, 2, 1, 3, 2, 4, 5, 6, 5, 7, 6])
  })
})
