import { describe, expect, it } from 'vitest'
import { Vector3 } from 'three'
import type { GeologicMap, GeologicUnitArea, MarsCoordinate } from '../../src/domain'
import { areaAt, areaContains } from '../../src/features/mars-3d/geologyArea'
import { areaFill, areaOutline, mergeAreas } from '../../src/features/mars-3d/geologyGeometry'

const R = 3.3895

// Test fixture only: shapes are invented squares, not the map's polygons.
const MAP: GeologicMap = {
  id: 'SIM 3464',
  title: 'test fixture',
  scaleDenominator: 75000,
  citation: 'test fixture',
}

function square(lat: number, lon: number, half: number): MarsCoordinate[] {
  return [
    { latitude: lat - half, longitudeEast: lon - half },
    { latitude: lat - half, longitudeEast: lon + half },
    { latitude: lat + half, longitudeEast: lon + half },
    { latitude: lat + half, longitudeEast: lon - half },
  ]
}

function area(name: string, rings: MarsCoordinate[][]): GeologicUnitArea {
  return { unit: { symbol: name, name, map: MAP }, rings }
}

const plain = area('plain', [square(18.4, 77.5, 0.1)])
const withHole = area('holed', [square(18.4, 77.5, 0.1), square(18.4, 77.5, 0.03)])
const acrossZero = area('wrap', [
  [
    { latitude: 0, longitudeEast: 359.9 },
    { latitude: 0, longitudeEast: 0.1 },
    { latitude: 0.2, longitudeEast: 0.1 },
    { latitude: 0.2, longitudeEast: 359.9 },
  ],
])

describe('geologyGeometry: areaFill', () => {
  it('triangulates a square into two triangles on the sphere', () => {
    const { positions, indices } = areaFill(plain, R)
    expect(positions.length).toBe(4 * 3)
    expect(indices.length).toBe(2 * 3)
    for (let i = 0; i < positions.length; i += 3) {
      expect(new Vector3().fromArray(positions, i).length()).toBeCloseTo(R, 5)
    }
  })

  it('ignores a repeated closing vertex', () => {
    const closed = area('closed', [[...square(18.4, 77.5, 0.1), square(18.4, 77.5, 0.1)[0]]])
    expect(areaFill(closed, R).positions.length).toBe(4 * 3)
  })

  it('leaves the hole unfilled', () => {
    const { positions, indices } = areaFill(withHole, R)
    expect(positions.length).toBe(8 * 3)
    // A square ring around a square hole is eight triangles.
    expect(indices.length).toBe(8 * 3)
  })

  it('triangulates a ring that crosses 0°/360°E', () => {
    expect(areaFill(acrossZero, R).indices.length).toBe(2 * 3)
  })

  it('yields nothing for a degenerate ring', () => {
    const line = area('line', [square(0, 10, 1).slice(0, 2)])
    expect(areaFill(line, R).positions.length).toBe(0)
    expect(areaFill(area('none', []), R).indices.length).toBe(0)
  })
})

describe('geologyGeometry: areaOutline', () => {
  it('draws every ring closed, as segment pairs', () => {
    // Two rings of four edges, two vertices per edge.
    expect(areaOutline(withHole, R).length).toBe(8 * 2 * 3)
  })
})

describe('geologyGeometry: areaContains and areaAt', () => {
  it('finds a point inside and not one outside', () => {
    expect(areaContains(plain, { latitude: 18.45, longitudeEast: 77.55 })).toBe(true)
    expect(areaContains(plain, { latitude: 18.6, longitudeEast: 77.5 })).toBe(false)
  })

  it('excludes points in a hole', () => {
    expect(areaContains(withHole, { latitude: 18.4, longitudeEast: 77.5 })).toBe(false)
    expect(areaContains(withHole, { latitude: 18.45, longitudeEast: 77.55 })).toBe(true)
  })

  it('handles points on either side of 0°/360°E', () => {
    expect(areaContains(acrossZero, { latitude: 0.1, longitudeEast: 359.95 })).toBe(true)
    expect(areaContains(acrossZero, { latitude: 0.1, longitudeEast: 0.05 })).toBe(true)
    expect(areaContains(acrossZero, { latitude: 0.1, longitudeEast: 0.2 })).toBe(false)
  })

  it('returns null where no unit is mapped', () => {
    const areas = [plain, acrossZero]
    expect(areaAt(areas, { latitude: 18.4, longitudeEast: 77.5 })).toBe(plain)
    expect(areaAt(areas, { latitude: -40, longitudeEast: 200 })).toBeNull()
  })
})

describe('geologyGeometry: mergeAreas', () => {
  it('offsets each area into one buffer with its own colour', () => {
    const red = { r: 1, g: 0, b: 0 }
    const blue = { r: 0, g: 0, b: 1 }
    const m = mergeAreas([plain, withHole], R, (a) => (a === plain ? red : blue))
    expect(m.positions.length).toBe((4 + 8) * 3)
    expect(m.indices.length).toBe((2 + 8) * 3)
    // The second area's triangles index past the first area's four vertices.
    expect(Math.min(...m.indices.slice(6))).toBe(4)
    expect(Array.from(m.colors.slice(0, 3))).toEqual([1, 0, 0])
    expect(Array.from(m.colors.slice(4 * 3, 4 * 3 + 3))).toEqual([0, 0, 1])
    expect(m.outline.length).toBe((4 + 8) * 2 * 3)
  })

  it('is empty for no areas', () => {
    expect(mergeAreas([], R, () => ({ r: 0, g: 0, b: 0 })).indices.length).toBe(0)
  })
})
