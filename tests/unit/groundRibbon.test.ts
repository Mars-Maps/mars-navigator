import { describe, expect, it } from 'vitest'
import { dashLines, groundRibbon, joinSegments } from '../../src/features/mars-3d/surfaceView/groundRibbon'
import type { Heightfield } from '../../src/features/mars-3d/surfaceView/heightfield'

// Test fixture only: an invented field 1 km across at 100 m, rising 0.1 m per metre to the north.
const size = 11
const heights = new Float32Array(size * size)
for (let r = 0; r < size; r++) for (let c = 0; c < size; c++) heights[r * size + c] = 100 + (500 - r * 100) * 0.1
const field: Heightfield = { heights, size, spacingM: 100 }

describe('groundRibbon: joinSegments', () => {
  it('joins pairs that share a vertex into one polyline and starts another at a break', () => {
    const pairs = new Float32Array([0, 0, 0, 1, 0, 0, 1, 0, 0, 2, 0, 0, 5, 0, 0, 6, 0, 0])
    expect(joinSegments(pairs)).toEqual([
      [
        [0, 0, 0],
        [1, 0, 0],
        [2, 0, 0],
      ],
      [
        [5, 0, 0],
        [6, 0, 0],
      ],
    ])
    expect(joinSegments(new Float32Array())).toEqual([])
  })
})

describe('groundRibbon: dashLines', () => {
  const along = (line: readonly (readonly number[])[]) => line.map((v) => v[0])

  it('cuts a line into dashes and gaps along its length, keeping the vertices inside a dash', () => {
    const dashes = dashLines([[[0, 0, 0], [10, 0, 0], [20, 0, 0]]], 3, 4)
    // Dashes at 0–3, 7–10, 14–17: the second ends exactly on the vertex at 10.
    expect(dashes.map(along)).toEqual([
      [0, 3],
      [7, 10],
      [14, 17],
    ])
  })

  it('carries a dash across a vertex, and the pattern on from one line to the next', () => {
    const dashes = dashLines([[[0, 0, 0], [2, 0, 0], [5, 0, 0]], [[100, 0, 0], [110, 0, 0]]], 3, 4)
    expect(along(dashes[0])).toEqual([0, 2, 3])
    // The first line is 5 long, so the second starts 5 into the pattern: in the gap until 7.
    expect(along(dashes[1])).toEqual([102, 105])
  })

  it('measures along a slope, and a phase shifts the dashes into the gaps', () => {
    const slope = dashLines([[[0, 0, 0], [3, 4, 0]]], 2.5, 10)
    expect(slope[0][1][0]).toBeCloseTo(1.5, 6)
    expect(slope[0][1][1]).toBeCloseTo(2, 6)
    const shifted = dashLines([[[0, 0, 0], [14, 0, 0]]], 3, 4, -3.5)
    expect(shifted.map((d) => along(d).map((x) => Number(x.toFixed(6))))).toEqual([
      [3.5, 6.5],
      [10.5, 13.5],
    ])
  })
})

describe('groundRibbon: groundRibbon', () => {
  it('lays the width across the line in the horizontal plane, each edge on the ground under it plus the lift', () => {
    // A line running east at 50 m north (z = −50); the ground rises to the north.
    const r = groundRibbon([[[0, 0, -50], [10, 0, -50]]], field, 2, 0.3)
    expect(r.positions).toHaveLength(12)
    expect(r.indices).toHaveLength(6)
    const zs = [r.positions[2], r.positions[5]].sort((a, b) => a - b)
    expect(zs[0]).toBeCloseTo(-51, 5)
    expect(zs[1]).toBeCloseTo(-49, 5)
    // Each edge takes its own height: 0.1 m per metre north, so the two differ by 0.2 m.
    for (let i = 0; i < 4; i++) {
      const z = r.positions[i * 3 + 2]
      expect(r.positions[i * 3 + 1]).toBeCloseTo(100 + -z * 0.1 + 0.3, 4)
    }
  })
})
