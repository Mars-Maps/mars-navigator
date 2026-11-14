import { describe, expect, it } from 'vitest'
import {
  clampWindowSize,
  coordinateToScreen,
  GLOBE_BOUNDS,
  MAX_MAP_TILES,
  MIN_WINDOW_PX,
  openWindowSize,
  PANEL_CHROME_PX,
  RIGHT_COLUMN_PX,
  panBy,
  pickPrecision,
  placements,
  SCREEN_MARGIN_PX,
  SURFACE_PANEL_MIN_PX,
  screenToCoordinate,
  tilePxPerDeg,
  tilesForMap,
  tileZoomFor,
  visibleTiles,
  wrapLongitude,
  zoomAt,
  zoomLimits,
  followWalker,
  type MapView,
} from '../../src/features/mars-3d/surfaceView/overheadMapView'
import { tileBounds } from '../../src/features/mars-3d/tilePyramid'

const SIZE = { width: 600, height: 400 }
const view = (latitude: number, longitudeEast: number, pxPerDeg: number): MapView => ({
  centre: { latitude, longitudeEast },
  pxPerDeg,
})

describe('followWalker', () => {
  // 10 px per degree on 600 × 400: the walker moves freely within 180 px east–west and 120 px north–south.
  it('leaves the view still while the walker moves in the middle, so their dot moves', () => {
    const v = view(0, 10, 10)
    expect(followWalker(v, SIZE, { latitude: 0.5, longitudeEast: 11 })).toBe(v)
    expect(followWalker(v, SIZE, { latitude: -12, longitudeEast: 28 })).toBe(v)
  })

  it('shifts just enough to hold the walker at the edge of the middle', () => {
    const east = followWalker(view(0, 10, 10), SIZE, { latitude: 0, longitudeEast: 30 })
    expect(east.centre.longitudeEast).toBeCloseTo(12, 10)
    expect(coordinateToScreen(east, SIZE, { latitude: 0, longitudeEast: 30 }).x).toBeCloseTo(480, 8)
    const south = followWalker(view(0, 10, 10), SIZE, { latitude: -15, longitudeEast: 10 })
    expect(south.centre.latitude).toBeCloseTo(-3, 10)
    expect(coordinateToScreen(south, SIZE, { latitude: -15, longitudeEast: 10 }).y).toBeCloseTo(320, 8)
  })

  it('re-centres on a walker off the window, as after a teleport', () => {
    const walker = { latitude: 1, longitudeEast: 50 }
    expect(followWalker(view(0, 10, 10), SIZE, walker).centre).toEqual(walker)
  })

  it('moves the dot across 0°E without a jump', () => {
    const v = view(0, 359, 10)
    expect(followWalker(v, SIZE, { latitude: 0, longitudeEast: 2 })).toBe(v)
  })

  it('keeps a steady walk in view, step by step', () => {
    let v = view(0, 10, 10)
    for (let lon = 10; lon <= 40; lon += 0.25) {
      v = followWalker(v, SIZE, { latitude: 0, longitudeEast: lon })
      const x = coordinateToScreen(v, SIZE, { latitude: 0, longitudeEast: lon }).x
      expect(x).toBeLessThanOrEqual(480 + 1e-6)
    }
    expect(v.centre.longitudeEast).toBeCloseTo(22, 8)
  })
})

describe('screenToCoordinate and coordinateToScreen', () => {
  it('puts the centre of the window at the view centre, north up', () => {
    const v = view(10, 100, 20)
    expect(screenToCoordinate(v, SIZE, 300, 200)).toEqual({ latitude: 10, longitudeEast: 100 })
    const ne = screenToCoordinate(v, SIZE, 320, 180)
    expect(ne.latitude).toBeCloseTo(11, 10)
    expect(ne.longitudeEast).toBeCloseTo(101, 10)
  })

  it('round-trips a point in the window', () => {
    const v = view(-35.5, 12.25, 37)
    const at = screenToCoordinate(v, SIZE, 123, 321)
    const back = coordinateToScreen(v, SIZE, at)
    expect(back.x).toBeCloseTo(123, 8)
    expect(back.y).toBeCloseTo(321, 8)
  })

  it('wraps longitude across the 0/360°E seam and never returns 360', () => {
    const v = view(0, 359.5, 10)
    expect(screenToCoordinate(v, SIZE, 310, 200).longitudeEast).toBeCloseTo(0.5, 10)
    expect(screenToCoordinate(v, SIZE, 305, 200).longitudeEast).toBe(0)
    expect(wrapLongitude(-0.25)).toBeCloseTo(359.75, 10)
    expect(wrapLongitude(720)).toBe(0)
  })

  it('draws a point across the seam on the near side of the centre', () => {
    const v = view(0, 359, 10)
    expect(coordinateToScreen(v, SIZE, { latitude: 0, longitudeEast: 1 }).x).toBeCloseTo(320, 8)
  })

  it('clamps latitude at the poles rather than inventing ground past them', () => {
    const v = view(85, 0, 2)
    expect(screenToCoordinate(v, SIZE, 300, 0).latitude).toBe(90)
  })
})

describe('panBy and zoomAt', () => {
  it('moves the ground with the pointer', () => {
    const v = panBy(view(0, 10, 10), 50, -20)
    // Dragging right brings the west into view; dragging up brings the south.
    expect(v.centre.longitudeEast).toBeCloseTo(5, 10)
    expect(v.centre.latitude).toBeCloseTo(-2, 10)
  })

  it('pans in every direction without limit east–west, and stops at the poles', () => {
    expect(panBy(view(0, 5, 1), 100, 0).centre.longitudeEast).toBeCloseTo(265, 10)
    expect(panBy(view(80, 0, 1), 0, 500).centre.latitude).toBe(90)
  })

  it('keeps the ground under the cursor fixed while zooming', () => {
    const v = view(20, 40, 10)
    const before = screenToCoordinate(v, SIZE, 450, 120)
    const z = zoomAt(v, SIZE, 450, 120, 3, { min: 1, max: 1000 })
    expect(z.pxPerDeg).toBe(30)
    const after = screenToCoordinate(z, SIZE, 450, 120)
    expect(after.latitude).toBeCloseTo(before.latitude, 8)
    expect(after.longitudeEast).toBeCloseTo(before.longitudeEast, 8)
  })

  it('stops at the zoom limits and leaves the view as it was', () => {
    const v = view(0, 0, 5)
    expect(zoomAt(v, SIZE, 0, 0, 100, { min: 1, max: 5 })).toBe(v)
    expect(zoomAt(v, SIZE, 0, 0, 0.001, { min: 2, max: 50 }).pxPerDeg).toBe(2)
  })

  it('zooms in further when asked, to a smallest span across the window', () => {
    // Viking stops at zoom 7 (about 364 px per degree doubled); a 5 km window on a 200 px map is closer.
    const closest = zoomLimits({ width: 200, height: 200 }, 7, 5 / 59.16)
    expect(closest.max).toBeCloseTo(200 / (5 / 59.16), 6)
    expect(zoomLimits({ width: 200, height: 200 }, 7, 100).max).toBe(tilePxPerDeg(7) * 2)
  })

  it('zooms out until the whole planet fits, and in to twice the finest tiles', () => {
    const limits = zoomLimits(SIZE, 7)
    expect(limits.min).toBeCloseTo(Math.min(600 / 360, 400 / 180), 10)
    expect(limits.max).toBe(tilePxPerDeg(7) * 2)
  })
})

describe('tiles for the view', () => {
  it('picks the coarsest tile zoom at least as fine as the screen, past the globe image', () => {
    // Zoom 3 tiles are 4096 px per 360°, about 11.4 px per degree.
    expect(tileZoomFor(5, 1, 3, 9)).toBeNull()
    expect(tileZoomFor(12, 1, 3, 9)).toBe(4)
    expect(tileZoomFor(12, 2, 3, 9)).toBe(5)
    expect(tileZoomFor(100_000, 1, 3, 9)).toBe(9)
    // No globe image: tiles from zoom 0.
    expect(tileZoomFor(0.1, 1, null, 9)).toBe(0)
    // The source stops at or below the image: nothing finer to ask for.
    expect(tileZoomFor(100, 1, 3, 3)).toBeNull()
  })

  it('lists the tiles covering the window, nearest the centre first, each once', () => {
    const v = view(0, 0, tilePxPerDeg(5))
    const tiles = visibleTiles(v, SIZE, 5)
    const keys = tiles.map((t) => `${t.row}/${t.col}`)
    expect(new Set(keys).size).toBe(keys.length)
    // A 600 × 400 window over 256 px tiles at their own scale: 4 × 3 or so.
    expect(tiles.length).toBeGreaterThanOrEqual(6)
    expect(tiles.length).toBeLessThanOrEqual(12)
    const first = tileBounds(tiles[0])
    expect(first.north).toBeGreaterThanOrEqual(0)
    expect(first.south).toBeLessThanOrEqual(0)
    for (const t of tiles) {
      expect(t.row).toBeGreaterThanOrEqual(0)
      expect(t.row).toBeLessThan(2 ** 5)
      expect(t.col).toBeGreaterThanOrEqual(0)
      expect(t.col).toBeLessThan(2 ** 6)
    }
  })

  it('caps the tiles of a large window on a dense display by going coarser', () => {
    // 1856 × 856 at 2×: zoom 7 is the one fine enough, its tiles ~102 px wide, about 200 of them.
    const big = { width: 1856, height: 856 }
    const v = view(0, 0, tilePxPerDeg(7) * 0.4)
    expect(tileZoomFor(v.pxPerDeg, 2 / 1.5, 3, 7)).toBe(7)
    expect(visibleTiles(v, big, 7).length).toBeGreaterThan(MAX_MAP_TILES)
    const got = tilesForMap(v, big, 2, 3, 7)
    expect(got?.zoom).toBe(6)
    expect(got!.tiles.length).toBeLessThanOrEqual(MAX_MAP_TILES)
  })

  it('asks for nothing when the globe image is fine enough', () => {
    expect(tilesForMap(view(0, 0, 2), SIZE, 1, 3, 7)).toBeNull()
  })

  it('wraps columns across 180°', () => {
    const tiles = visibleTiles(view(0, 180, tilePxPerDeg(4)), SIZE, 4)
    const cols = new Set(tiles.map((t) => t.col))
    expect(cols.has(0)).toBe(true)
    expect(cols.has(2 ** 5 - 1)).toBe(true)
  })

  it('places the globe image so its left edge is 180°W and its top 90°N', () => {
    expect(placements(view(0, 0, 1), { width: 360, height: 180 }, GLOBE_BOUNDS)).toEqual([
      { x: 0, y: 0, w: 360, h: 180 },
    ])
  })

  it('draws an image once per copy of its longitude the window shows', () => {
    // A window wider than the planet shows the seam twice.
    const wide = { width: 900, height: 180 }
    expect(placements(view(0, 0, 1), wide, GLOBE_BOUNDS).length).toBe(3)
  })
})

describe('the window', () => {
  const screen = { width: 1920, height: 1080 }

  it('opens at about 30% of the screen each way', () => {
    expect(openWindowSize(screen)).toEqual({ width: 576, height: 324 })
  })

  it('resizes between its minimum and the screen less the margins', () => {
    expect(clampWindowSize({ width: 10, height: 10 }, screen)).toEqual({ width: MIN_WINDOW_PX, height: MIN_WINDOW_PX })
    expect(clampWindowSize({ width: 5000, height: 5000 }, screen)).toEqual({
      // The time menu and compass keep their strip; the panel's header and caption and the surface panel's title stay on screen.
      width: 1920 - 2 * SCREEN_MARGIN_PX - RIGHT_COLUMN_PX,
      height: 1080 - 2 * SCREEN_MARGIN_PX - PANEL_CHROME_PX - SURFACE_PANEL_MIN_PX,
    })
  })

  it('shrinks below its minimum on a tiny screen, to a floor', () => {
    expect(clampWindowSize({ width: 400, height: 400 }, { width: 600, height: 500 })).toEqual({
      width: 600 - 2 * SCREEN_MARGIN_PX - RIGHT_COLUMN_PX,
      height: 500 - 2 * SCREEN_MARGIN_PX - PANEL_CHROME_PX - SURFACE_PANEL_MIN_PX,
    })
    expect(clampWindowSize({ width: 400, height: 400 }, { width: 100, height: 100 })).toEqual({ width: 120, height: 120 })
  })

  it('shows a picked coordinate to about one screen pixel', () => {
    expect(pickPrecision(1)).toBe(1)
    expect(pickPrecision(50)).toBe(2)
    expect(pickPrecision(5000)).toBe(4)
    expect(pickPrecision(1e9)).toBe(5)
  })
})
