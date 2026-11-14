import { describe, expect, it } from 'vitest'
import {
  blockMeets,
  blockShift,
  blockTiles,
  nearBlock,
  nearUvMap,
  NEAR_TILES,
  sameBlock,
} from '../../src/features/mars-3d/surfaceView/nearField'
import { makeFrame, toPatch } from '../../src/features/mars-3d/surfaceView/surfacePatch'

// Inside the HiRISE box at Jezero, and Gale far from it.
const hiriseBox = { south: 18.3067994, north: 18.669315, west: 77.2229331, east: 77.583964 }
const jezero = { latitude: 18.44, longitudeEast: 77.45 }
const gale = { latitude: -5.4, longitudeEast: 137.8 }
const SPAN_17 = 180 / 2 ** 17

describe('nearBlock', () => {
  it('is 8 × 8 zoom-17 tiles, about 650 m north to south, centred within half a tile of the walker', () => {
    const b = nearBlock(jezero, 17)
    expect(b.n).toBe(NEAR_TILES)
    expect(b.bounds.north - b.bounds.south).toBeCloseTo(8 * SPAN_17, 12)
    expect(b.bounds.width).toBeCloseTo(8 * SPAN_17, 12)
    // 59.16 km per degree on Mars's mean radius.
    expect((b.bounds.north - b.bounds.south) * 59.16).toBeCloseTo(0.651, 2)
    const midLat = (b.bounds.north + b.bounds.south) / 2
    const midLon = b.bounds.west + b.bounds.width / 2
    expect(Math.abs(midLat - jezero.latitude)).toBeLessThanOrEqual(SPAN_17 / 2 + 1e-12)
    expect(Math.abs(midLon - jezero.longitudeEast)).toBeLessThanOrEqual(SPAN_17 / 2 + 1e-12)
  })

  it('is the same block for a nearby point and a different one a few tiles away', () => {
    const a = nearBlock(jezero, 17)
    expect(sameBlock(a, nearBlock({ latitude: jezero.latitude + SPAN_17 / 10, longitudeEast: jezero.longitudeEast }, 17))).toBe(true)
    expect(sameBlock(a, nearBlock({ latitude: jezero.latitude + 3 * SPAN_17, longitudeEast: jezero.longitudeEast }, 17))).toBe(false)
    expect(sameBlock(null, a)).toBe(false)
  })

  it('stays inside the grid at a pole, and wraps its columns across 180°E', () => {
    const polar = nearBlock({ latitude: 89.9999, longitudeEast: 10 }, 17)
    expect(polar.row0).toBe(0)
    expect(polar.bounds.north).toBe(90)
    const dateline = nearBlock({ latitude: 0, longitudeEast: 180 }, 17)
    const columns = 2 ** 18
    expect(dateline.col0).toBe(columns - NEAR_TILES / 2)
    const tiles = blockTiles(dateline, null, { latitude: 0, longitudeEast: 180 })
    expect(tiles).toHaveLength(64)
    expect(tiles.every((t) => t.tile.col >= 0 && t.tile.col < columns)).toBe(true)
  })
})

describe('blockTiles and blockMeets', () => {
  it('asks for every tile inside the box, the tile underfoot first', () => {
    const b = nearBlock(jezero, 17)
    expect(blockMeets(b, hiriseBox)).toBe(true)
    const tiles = blockTiles(b, hiriseBox, jezero)
    expect(tiles).toHaveLength(64)
    const first = tiles[0].tile
    const north = 90 - first.row * SPAN_17
    expect(jezero.latitude).toBeLessThanOrEqual(north)
    expect(jezero.latitude).toBeGreaterThanOrEqual(north - SPAN_17)
    expect(new Set(tiles.map((t) => `${t.x}/${t.y}`)).size).toBe(64)
  })

  it('asks only for the tiles that meet the box at its edge, and none away from it', () => {
    const edge = { latitude: 18.44, longitudeEast: hiriseBox.east }
    const tiles = blockTiles(nearBlock(edge, 17), hiriseBox, edge)
    expect(tiles.length).toBeGreaterThan(0)
    expect(tiles.length).toBeLessThan(64)
    expect(blockMeets(nearBlock(gale, 17), hiriseBox)).toBe(false)
    expect(blockTiles(nearBlock(gale, 17), hiriseBox, gale)).toEqual([])
  })
})

describe('blockShift', () => {
  it('says where the shared tiles move, and null when nothing is shared', () => {
    const a = nearBlock(jezero, 17)
    const b = { ...a, row0: a.row0 + 2, col0: a.col0 - 3 }
    expect(blockShift(a, b)).toEqual({ dx: -3, dy: 2 })
    expect(blockShift(a, { ...a, row0: a.row0 + 8 })).toBeNull()
    expect(blockShift(a, { ...a, zoom: 16 })).toBeNull()
  })

  it('takes the short way across 180°E', () => {
    const columns = 2 ** 18
    const a = { ...nearBlock(jezero, 17), col0: columns - 2 }
    expect(blockShift(a, { ...a, col0: 1 })).toEqual({ dx: 3, dy: 0 })
  })
})

describe('nearUvMap', () => {
  // The patch is centred kilometres from the block, as after walking.
  const frame = makeFrame({ latitude: 18.47, longitudeEast: 77.41 })
  const block = nearBlock(jezero, 17)
  const map = nearUvMap(frame, block.bounds)
  const uv = (lat: number, lon: number) => {
    const p = toPatch(frame, { latitude: lat, longitudeEast: lon })
    const x = p.xKm * 1000
    const y = p.yKm * 1000
    return {
      u: map.u[0] * x + map.u[1] * y + map.u[2],
      v: map.v[0] * x + map.v[1] * y + map.v[2],
    }
  }
  const { north, south, west, width } = block.bounds

  it('puts the block’s corners at 0 and 1, west to east and south to north, within 5 cm', () => {
    // About 1 cm today at the corners, 5 km from the patch centre: a few percent of a 0.32 m pixel.
    const cm = 0.05 / 650
    for (const [lat, lon, u, v] of [
      [south, west, 0, 0],
      [north, west, 0, 1],
      [south, west + width, 1, 0],
      [north, west + width, 1, 1],
      [(north + south) / 2, west + width / 2, 0.5, 0.5],
    ]) {
      const got = uv(lat, lon)
      expect(Math.abs(got.u - u)).toBeLessThan(cm)
      expect(Math.abs(got.v - v)).toBeLessThan(cm)
    }
  })

  it('gives the block centre in patch metres, for the recentre test', () => {
    const p = toPatch(frame, { latitude: (north + south) / 2, longitudeEast: west + width / 2 })
    expect(map.centre.xM).toBeCloseTo(p.xKm * 1000, 6)
    expect(map.centre.yM).toBeCloseTo(p.yKm * 1000, 6)
  })
})
