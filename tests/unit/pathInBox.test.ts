import { describe, expect, it } from 'vitest'
import { pathCrossesBox, pathInBox } from '../../src/features/route-analysis/pathInBox'
import type { TerrainProfileCorners } from '../../src/features/route-analysis/terrainProfile'
import { planePoint, terrainProfileGrid, type TerrainProfileGrid } from '../../src/features/route-analysis/terrainProfileGrid'
import { at } from './terrain.helpers'

// Test fixtures only: an invented 2 km square near Jezero and paths over it, never shown in the app.
const SQUARE: TerrainProfileCorners = [at(0, 0), at(2, 0), at(2, 2), at(0, 2)]
function gridOf(): TerrainProfileGrid {
  const g = terrainProfileGrid(SQUARE, { cellKm: 1 })
  if (g.classification !== 'DERIVED') throw new Error(g.classification)
  return g.value
}
const GRID = gridOf()
const xy = (lines: { x: number; y: number }[][]) => lines.map((l) => l.map((p) => [+p.x.toFixed(3), +p.y.toFixed(3)]))

describe('planePoint', () => {
  it('puts a coordinate in the grid\'s frame, km east and north of the first corner, the short way round', () => {
    const p = planePoint(GRID.frame, at(1.5, -0.5))
    expect(p.x).toBeCloseTo(1.5, 3)
    expect(p.y).toBeCloseTo(-0.5, 6)
    expect(planePoint(GRID.frame, GRID.frame.origin)).toEqual({ x: 0, y: 0 })
    const west = planePoint({ origin: { latitude: 0, longitudeEast: 1 }, kmPerDegEast: 10 }, { latitude: 0, longitudeEast: 359 })
    expect(west.x).toBeCloseTo(-20, 9)
  })

  it('the grid\'s corners are its own frame\'s points', () => {
    SQUARE.forEach((c, i) => {
      const p = planePoint(GRID.frame, c)
      expect(p.x).toBeCloseTo(GRID.cornersKm[i].x, 9)
      expect(p.y).toBeCloseTo(GRID.cornersKm[i].y, 9)
    })
  })
})

describe('pathInBox', () => {
  it('keeps a path inside the box whole, as one line', () => {
    const lines = pathInBox(GRID, [at(0.5, 0.5), at(1, 1), at(1.5, 1.5)])
    expect(xy(lines)).toEqual([[[0.5, 0.5], [1, 1], [1.5, 1.5]]])
  })

  it('clips a path that crosses the box to the box\'s edges', () => {
    const lines = pathInBox(GRID, [at(-1, 1), at(3, 1)])
    expect(xy(lines)).toEqual([[[0, 1], [2, 1]]])
    const diagonal = pathInBox(GRID, [at(3, 0), at(0, 3)])
    expect(xy(diagonal)).toEqual([[[2, 1], [1, 2]]])
  })

  it('leaves out a path that never enters the box, one that passes outside a corner, and one of a single point', () => {
    expect(pathInBox(GRID, [at(-1, -1), at(-1, 3)])).toEqual([])
    expect(pathInBox(GRID, [at(5.5, -1), at(-1, 5.5)])).toEqual([])
    expect(pathInBox(GRID, [at(1, 1)])).toEqual([])
    expect(pathInBox(GRID, [])).toEqual([])
  })

  it('breaks the line where the path leaves the box and starts another where it comes back', () => {
    const lines = pathInBox(GRID, [at(0.5, 0.5), at(0.5, 3), at(1.5, 3), at(1.5, 0.5)])
    expect(xy(lines)).toEqual([
      [[0.5, 0.5], [0.5, 2]],
      [[1.5, 2], [1.5, 0.5]],
    ])
  })

  it('joins consecutive segments inside the box and drops a zero-length step', () => {
    const lines = pathInBox(GRID, [at(-1, 0.5), at(0.5, 0.5), at(0.5, 0.5), at(1.5, 1.5), at(1.5, 1.5)])
    expect(xy(lines)).toEqual([[[0, 0.5], [0.5, 0.5], [1.5, 1.5]]])
  })

  it('keeps a path along an edge, and one that leaves through an edge and comes straight back', () => {
    expect(xy(pathInBox(GRID, [at(-1, 0), at(3, 0)]))).toEqual([[[0, 0], [2, 0]]])
    // Out through the east edge at (2, 0.5), back in at (2, 1.5): two lines, never joined.
    expect(xy(pathInBox(GRID, [at(1, 0.5), at(3, 0.5), at(3, 1.5), at(1, 1.5)]))).toEqual([
      [[1, 0.5], [2, 0.5]],
      [[2, 1.5], [1, 1.5]],
    ])
  })

  it('says whether the path crosses the box at all', () => {
    expect(pathCrossesBox(GRID, [at(-1, 1), at(3, 1)])).toBe(true)
    expect(pathCrossesBox(GRID, [at(-1, -1), at(-1, 3)])).toBe(false)
  })
})
