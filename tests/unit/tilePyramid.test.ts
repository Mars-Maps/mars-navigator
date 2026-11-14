import { describe, expect, it } from 'vitest'
import { MARS_MEAN_RADIUS_KM } from '../../src/domain'
import {
  BASE_ZOOM,
  MAX_VISIBLE_TILES,
  angleBetween,
  groundMetresPerPixel,
  tileBounds,
  tileKey,
  tileMetresPerPixel,
  tilesForView,
  visibleCapRadians,
  visibleTiles,
  zoomForView,
} from '../../src/features/mars-3d/tilePyramid'
import { buildTilePatch } from '../../src/features/mars-3d/tilePatch'
import { localPointToCoordinate } from '../../src/features/mars-3d/projection'
import { Vector3 } from 'three'

const R = MARS_MEAN_RADIUS_KM
const screen = { fovDeg: 45, heightPx: 900, aspect: 1.6 }

describe('tileBounds', () => {
  it('starts at 180°E, 90°N, with 2^(z+1) × 2^z tiles', () => {
    expect(tileBounds({ zoom: 0, row: 0, col: 0 })).toEqual({ north: 90, south: -90, west: 180, width: 180 })
    expect(tileBounds({ zoom: 0, row: 0, col: 1 })).toEqual({ north: 90, south: -90, west: 0, width: 180 })
    expect(tileBounds({ zoom: 1, row: 1, col: 1 })).toEqual({ north: 0, south: -90, west: 270, width: 90 })
    expect(tileBounds({ zoom: 2, row: 0, col: 4 })).toEqual({ north: 90, south: 45, west: 0, width: 45 })
  })

  it('never straddles 0°E', () => {
    for (const zoom of [1, 2, 3, 5]) {
      const span = 180 / 2 ** zoom
      for (let col = 0; col < 2 ** (zoom + 1); col++) {
        const b = tileBounds({ zoom, row: 0, col })
        expect(b.west % span).toBe(0)
        expect(b.west + b.width).toBeLessThanOrEqual(360)
      }
    }
  })

  it('keys are unique per tile', () => {
    expect(tileKey({ zoom: 3, row: 1, col: 12 })).toBe('3/1/12')
  })
})

describe('resolution rule', () => {
  it('matches the adapter’s equatorial figure at zoom 2 (≈ 10.4 km/px)', () => {
    expect(tileMetresPerPixel(2, R) / 1000).toBeCloseTo(10.4, 1)
    expect(tileMetresPerPixel(7, R)).toBeCloseTo(325, 0)
  })

  it('screen pixels get finer as the camera descends', () => {
    expect(groundMetresPerPixel(2000, 45, 900)).toBeCloseTo(1841, 0)
    expect(groundMetresPerPixel(200, 45, 900)).toBeCloseTo(184, 0)
  })

  it('needs no tiles when the source has nothing finer than the base zoom, or very high up', () => {
    expect(zoomForView(200, 45, 900, BASE_ZOOM, R)).toBeNull()
    expect(zoomForView(25000, 45, 900, 7, R)).toBeNull()
    // The starting altitude on a 900 px screen is just past zoom 2; welcome
    // is gated by the component, not by this rule.
    expect(zoomForView(7460, 45, 900, 7, R)).toBe(3)
  })

  it('picks finer zooms as the camera descends, capped at the source maximum', () => {
    expect(zoomForView(2000, 45, 900, 7, R)).toBe(4)
    expect(zoomForView(1000, 45, 900, 7, R)).toBe(5)
    expect(zoomForView(800, 45, 900, 7, R)).toBe(6)
    expect(zoomForView(200, 45, 900, 7, R)).toBe(7)
    expect(zoomForView(200, 45, 900, 9, R)).toBe(8)
    // A layer served to zoom 1 only (as the TES mineral map once was) never gets detail tiles.
    expect(zoomForView(200, 45, 900, 1, R)).toBeNull()
  })

  it('refuses nonsense inputs', () => {
    expect(zoomForView(0, 45, 900, 7, R)).toBeNull()
    expect(zoomForView(NaN, 45, 900, 7, R)).toBeNull()
    expect(zoomForView(500, 45, 0, 7, R)).toBeNull()
  })
})

describe('visible cap', () => {
  it('is the horizon high up and the screen reach low down', () => {
    const high = visibleCapRadians(7460, 45, 1.6, R)
    expect(high).toBeCloseTo(Math.acos(R / (R + 7460)), 6)
    const low = visibleCapRadians(200, 45, 1.6, R)
    expect(low).toBeLessThan(Math.acos(R / (R + 200)))
    expect(low).toBeGreaterThan(0.03)
    expect(low).toBeLessThan(0.08)
  })
})

describe('visibleCapRadians reaches the screen corner', () => {
  // The ground angle under the screen corner, by marching the corner ray.
  const cornerByRay = (h: number, fovDeg: number, aspect: number) => {
    const t = Math.tan(((fovDeg / 2) * Math.PI) / 180) * Math.hypot(1, aspect)
    const dir = new Vector3(t, 0, -1).normalize()
    const cam = new Vector3(0, 0, R + h)
    // Nearest hit of cam + s·dir on the sphere of radius R.
    const b = cam.dot(dir)
    const disc = b * b - (cam.lengthSq() - R * R)
    if (disc < 0) return Math.acos(R / (R + h))
    const hit = cam.clone().addScaledVector(dir, -b - Math.sqrt(disc))
    return Math.acos(hit.z / R)
  }

  it('covers the corner at every altitude with the 25° lens, up to the horizon', () => {
    for (const h of [374, 1000, 2000, 3500, 4000, 5000, 7000, 20000]) {
      const cap = visibleCapRadians(h, 25, 16 / 9, R)
      expect(cap).toBeGreaterThanOrEqual(cornerByRay(h, 25, 16 / 9) - 1e-9)
      expect(cap).toBeLessThanOrEqual(Math.acos(R / (R + h)) + 1e-12)
    }
  })
})

describe('angleBetween', () => {
  it('is zero to itself, 90° along the equator, and wraps at 360', () => {
    const a = { latitude: 0, longitudeEast: 10 }
    expect(angleBetween(a, a)).toBe(0)
    expect(angleBetween(a, { latitude: 0, longitudeEast: 100 })).toBeCloseTo(Math.PI / 2, 9)
    expect(angleBetween({ latitude: 0, longitudeEast: 359 }, { latitude: 0, longitudeEast: 1 })).toBeCloseTo(
      (2 * Math.PI) / 180,
      9,
    )
  })
})

describe('visibleTiles', () => {
  const centre = { latitude: 10, longitudeEast: 300 }

  it('returns the tiles touching the cap, nearest first, all at the requested zoom', () => {
    const tiles = visibleTiles(5, centre, 0.1)
    expect(tiles.length).toBeGreaterThan(0)
    expect(tiles.every((t) => t.zoom === 5)).toBe(true)
    const first = tileBounds(tiles[0])
    expect(first.north).toBeGreaterThanOrEqual(centre.latitude)
    expect(first.south).toBeLessThanOrEqual(centre.latitude)
    expect(first.west).toBeLessThanOrEqual(centre.longitudeEast)
    expect(first.west + first.width).toBeGreaterThanOrEqual(centre.longitudeEast)
    // Nearest first: distances do not decrease.
    const centres = tiles.map((t) => {
      const b = tileBounds(t)
      return { latitude: (b.north + b.south) / 2, longitudeEast: (b.west + b.width / 2) % 360 }
    })
    for (let i = 1; i < centres.length; i++) {
      expect(angleBetween(centre, centres[i])).toBeGreaterThanOrEqual(angleBetween(centre, centres[i - 1]) - 1e-9)
    }
  })

  it('a wide cap at a fine zoom gives up instead of flooding', () => {
    expect(visibleTiles(7, centre, 1.2)).toEqual([])
  })

  it('covers the pole without gaps', () => {
    const tiles = visibleTiles(3, { latitude: 88, longitudeEast: 45 }, 0.05)
    // Every column of the top row touches a cap around the pole.
    expect(tiles.filter((t) => t.row === 0).length).toBe(16)
  })
})

describe('tilesForView', () => {
  it('falls back to a coarser zoom when the finest would need too many tiles', () => {
    // A tall screen at a middling altitude: zoom 5 over a wide cap.
    const result = tilesForView({ altitudeKm: 1500, target: { latitude: 0, longitudeEast: 0 } }, screen, 9, R)
    expect(result).not.toBeNull()
    expect(result!.tiles.length).toBeLessThanOrEqual(MAX_VISIBLE_TILES)
    expect(result!.tiles.length).toBeGreaterThan(0)
  })

  it('is null at the altitude ceiling', () => {
    expect(tilesForView({ altitudeKm: 25000, target: { latitude: 0, longitudeEast: 0 } }, screen, 7, R)).toBeNull()
  })

  it('covers the visible hemisphere at the starting altitude within the tile budget', () => {
    const result = tilesForView({ altitudeKm: 7460, target: { latitude: 0, longitudeEast: 0 } }, screen, 7, R)
    expect(result!.zoom).toBe(3)
    expect(result!.tiles.length).toBeGreaterThan(30)
    expect(result!.tiles.length).toBeLessThanOrEqual(MAX_VISIBLE_TILES)
  })

  it('keeps the floor view small', () => {
    const result = tilesForView({ altitudeKm: 200, target: { latitude: -20, longitudeEast: 120 } }, screen, 7, R)
    expect(result!.zoom).toBe(7)
    expect(result!.tiles.length).toBeLessThan(60)
  })
})

describe('buildTilePatch', () => {
  it('puts its corners on the tile’s bounds and its UVs north-up, west-left', () => {
    const bounds = tileBounds({ zoom: 2, row: 1, col: 5 }) // 45..0°N, 45..90°E
    const g = buildTilePatch(bounds, 1)
    const pos = g.getAttribute('position')
    const uv = g.getAttribute('uv')
    expect(pos.count).toBe(81)
    expect(g.getIndex()!.count).toBe(8 * 8 * 6)
    const corner = (i: number) => localPointToCoordinate(new Vector3().fromBufferAttribute(pos, i), 1)
    expect(corner(0).latitude).toBeCloseTo(45, 4)
    expect(corner(0).longitudeEast).toBeCloseTo(45, 4)
    expect(uv.getX(0)).toBe(0)
    expect(uv.getY(0)).toBe(0)
    expect(corner(80).latitude).toBeCloseTo(0, 4)
    expect(corner(80).longitudeEast).toBeCloseTo(90, 4)
    expect(uv.getX(80)).toBe(1)
    expect(uv.getY(80)).toBe(1)
    g.dispose()
  })

  it('carries outward unit normals for the lit tile material', () => {
    const g = buildTilePatch(tileBounds({ zoom: 3, row: 2, col: 9 }), 2)
    const pos = g.getAttribute('position')
    const nor = g.getAttribute('normal')
    expect(nor.count).toBe(pos.count)
    for (let i = 0; i < pos.count; i++) {
      const n = new Vector3().fromBufferAttribute(nor, i)
      expect(n.length()).toBeCloseTo(1, 6)
      expect(n.dot(new Vector3().fromBufferAttribute(pos, i).normalize())).toBeCloseTo(1, 6)
    }
    g.dispose()
  })
})

describe('buildTilePatch winding', () => {
  it('faces outward, so back-face culling keeps the tiles visible', () => {
    for (const t of [
      { zoom: 2, row: 1, col: 5 },
      { zoom: 3, row: 0, col: 0 },
      { zoom: 7, row: 100, col: 200 },
    ]) {
      const g = buildTilePatch(tileBounds(t), 1)
      const pos = g.getAttribute('position')
      const idx = g.getIndex()!
      const a = new Vector3().fromBufferAttribute(pos, idx.getX(0))
      const b = new Vector3().fromBufferAttribute(pos, idx.getX(1))
      const c = new Vector3().fromBufferAttribute(pos, idx.getX(2))
      const normal = new Vector3().subVectors(b, a).cross(new Vector3().subVectors(c, a))
      expect(normal.dot(a)).toBeGreaterThan(0)
      g.dispose()
    }
  })
})
