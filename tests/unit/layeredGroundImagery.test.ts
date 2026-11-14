import { afterEach, describe, expect, it, vi } from 'vitest'
import { groundImageryList } from '../../src/app/surfaceLayers'
import { describeGroundDetails } from '../../src/data/adapters/LayerAdapter'
import { CTX_GROUND_DETAIL, JEZERO_CTX_GROUND_DETAIL } from '../../src/data/layers/groundDetailSources'
import { derived } from '../../src/domain'
import type { GroundImagery } from '../../src/features/mars-3d/surfaceDetail'
import {
  areaPlacement,
  clipBox,
  composePatch,
  drawPatchImage,
  equirectPieces,
  type DrawPiece,
  groundLimits,
  pickZoom,
} from '../../src/features/mars-3d/surfaceView/patchImage'
import { makeFrame, patchBox, patchGrid } from '../../src/features/mars-3d/surfaceView/surfacePatch'
import { tileBounds } from '../../src/features/mars-3d/tilePyramid'

// A 40 km patch centred in Jezero, and one at Gale far from it.
const jezero = { latitude: 18.44, longitudeEast: 77.45 }
const jezeroBox = patchBox(makeFrame(jezero), patchGrid(makeFrame(jezero), 9))
const gale = { latitude: -5.4, longitudeEast: 137.8 }
const galeBox = patchBox(makeFrame(gale), patchGrid(makeFrame(gale), 9))
const hiriseBox = { south: 18.3067994, north: 18.669315, west: 77.2229331, east: 77.583964 }

describe('groundLimits', () => {
  it('keeps 512 px tiles at zoom 10 and 40 tiles, and gives 256 px tiles one zoom more and 4× the tiles', () => {
    expect(groundLimits(512)).toEqual({ maxZoom: 10, maxTiles: 40 })
    expect(groundLimits(256)).toEqual({ maxZoom: 11, maxTiles: 160 })
  })
})

describe('clipBox', () => {
  it('returns the whole box for a mosaic that covers the planet', () => {
    expect(clipBox(jezeroBox, jezero.longitudeEast, null)).toBe(jezeroBox)
  })

  it('clips a patch in Jezero to the HiRISE box, in the patch’s relative longitudes', () => {
    const c = clipBox(jezeroBox, jezero.longitudeEast, hiriseBox)
    expect(c).not.toBeNull()
    if (!c) return
    expect(c.south).toBeCloseTo(Math.max(jezeroBox.south, hiriseBox.south), 9)
    expect(c.north).toBeCloseTo(Math.min(jezeroBox.north, hiriseBox.north), 9)
    expect(c.westRel).toBeCloseTo(Math.max(jezeroBox.westRel, hiriseBox.west - 77.45), 9)
    expect(c.eastRel).toBeCloseTo(Math.min(jezeroBox.eastRel, hiriseBox.east - 77.45), 9)
  })

  it('finds no overlap at Gale', () => {
    expect(clipBox(galeBox, gale.longitudeEast, hiriseBox)).toBeNull()
  })

  it('reads the mosaic’s longitudes on any turn', () => {
    const shifted = { ...hiriseBox, west: hiriseBox.west - 360, east: hiriseBox.east - 360 }
    const a = clipBox(jezeroBox, jezero.longitudeEast, shifted)
    const b = clipBox(jezeroBox, jezero.longitudeEast, hiriseBox)
    expect(a).not.toBeNull()
    if (!a || !b) return
    // Equal up to the rounding of a 360° shift.
    for (const k of ['south', 'north', 'westRel', 'eastRel'] as const) expect(a[k]).toBeCloseTo(b[k], 9)
  })
})

describe('HiRISE tiles over a Jezero patch', () => {
  it('fit the 256 px budget at zoom 11 (≈ 20 m/px) and lie only over the HiRISE box', () => {
    const area = clipBox(jezeroBox, jezero.longitudeEast, hiriseBox)
    expect(area).not.toBeNull()
    if (!area) return
    const limits = groundLimits(256)
    const { zoom, tiles } = pickZoom(limits.maxZoom, area, jezero.longitudeEast, limits.maxTiles)
    expect(zoom).toBe(11)
    expect(tiles.length).toBeLessThanOrEqual(limits.maxTiles)
    for (const t of tiles.map(tileBounds)) {
      expect(t.west + t.width).toBeGreaterThan(hiriseBox.west)
      expect(t.west).toBeLessThan(hiriseBox.east)
      expect(t.north).toBeGreaterThan(hiriseBox.south)
      expect(t.south).toBeLessThan(hiriseBox.north)
    }
  })
})

describe('composePatch with several mosaics', () => {
  it('draws every brightness canvas in luminosity mode, coarsest first, so the finest wins', () => {
    const calls: string[] = []
    const ctx = new Proxy({} as CanvasRenderingContext2D, {
      get: (_t, name: string) => (...args: unknown[]) => calls.push(`${name}(${String(args[0])})`),
      set: (_t, name: string, value: unknown) => {
        calls.push(`${name}=${String(value)}`)
        return true
      },
    })
    const canvas = (name: string) => ({ toString: () => name }) as unknown as HTMLCanvasElement
    const whole = (name: string) => ({ image: canvas(name), x: 0, y: 0, w: 2048, h: 2048 })
    composePatch(ctx, canvas('colour'), [whole('ctx'), whole('jezero-ctx'), whole('hirise')], 2048)
    expect(calls.slice(3)).toEqual([
      'drawImage(colour)',
      'globalCompositeOperation=luminosity',
      'drawImage(ctx)',
      'drawImage(jezero-ctx)',
      'drawImage(hirise)',
      'globalCompositeOperation=source-over',
    ])
  })
})

describe('groundImageryList', () => {
  it('lists the mosaics coarsest first, with tile size and box, HiRISE marked for the near field only', () => {
    const list = groundImageryList()
    expect(list.map((g) => g.detail.layerId)).toEqual(['ctx', 'jezero-ctx', 'jezero-hirise'])
    expect(list.map((g) => g.tilePx)).toEqual([512, 256, 256])
    expect(list.map((g) => g.nearField === true)).toEqual([false, false, true])
    expect(list[0].coverage).toBeNull()
    expect(list[1].coverage).toEqual(JEZERO_CTX_GROUND_DETAIL.coverage)
    expect(list[2].coverage).toEqual(hiriseBox)
  })

  it('leaves out a mosaic whose record fails validation', () => {
    const broken = { ...JEZERO_CTX_GROUND_DETAIL, licence: '' }
    const list = groundImageryList(describeGroundDetails([broken, CTX_GROUND_DETAIL]))
    expect(list.map((g) => g.detail.layerId)).toEqual(['ctx'])
  })
})

describe('areaPlacement', () => {
  it('is the whole image for a mosaic covering the patch', () => {
    const p = areaPlacement(jezeroBox, jezeroBox, 2048)
    expect([p.x, p.y, p.w, p.h]).toEqual([0, 0, 2048, 2048])
    expect(p.box.westRel).toBeCloseTo(jezeroBox.westRel, 12)
    expect(p.box.eastRel).toBeCloseTo(jezeroBox.eastRel, 12)
    expect(p.box.north).toBeCloseTo(jezeroBox.north, 12)
    expect(p.box.south).toBeCloseTo(jezeroBox.south, 12)
  })

  it('covers a partial mosaic with whole result pixels, on the result’s grid', () => {
    const jezCtx = { south: 18.2110274, north: 18.7211945, west: 77.1604655, east: 77.6991776 }
    const area = clipBox(jezeroBox, jezero.longitudeEast, jezCtx)
    expect(area).not.toBeNull()
    if (!area) return
    const p = areaPlacement(jezeroBox, area, 2048)
    for (const v of [p.x, p.y, p.w, p.h]) expect(Number.isInteger(v)).toBe(true)
    expect(p.x + p.w).toBeLessThanOrEqual(2048)
    expect(p.y + p.h).toBeLessThanOrEqual(2048)
    // The pixel rectangle holds the whole area, by under one pixel on each side.
    const across = jezeroBox.eastRel - jezeroBox.westRel
    const down = jezeroBox.north - jezeroBox.south
    expect(p.box.westRel).toBeLessThanOrEqual(area.westRel)
    expect(area.westRel - p.box.westRel).toBeLessThan(across / 2048)
    expect(p.box.eastRel).toBeGreaterThanOrEqual(area.eastRel)
    expect(p.box.eastRel - area.eastRel).toBeLessThan(across / 2048)
    expect(p.box.north).toBeGreaterThanOrEqual(area.north)
    expect(p.box.north - area.north).toBeLessThan(down / 2048)
    expect(p.box.south).toBeLessThanOrEqual(area.south)
    expect(area.south - p.box.south).toBeLessThan(down / 2048)
    // Same pixels per degree as the full image: a tile lands on the same result pixels.
    expect(p.w / (p.box.eastRel - p.box.westRel)).toBeCloseTo(2048 / across, 6)
    expect(p.h / (p.box.north - p.box.south)).toBeCloseTo(2048 / down, 6)
    // Memory: the overlap's canvas is a fraction of a full one.
    expect((p.w * p.h) / (2048 * 2048)).toBeLessThan(0.75)
  })
})

describe('areaPlacement rasterizes as the full canvas does', () => {
  it('puts every tile on the same result pixels as a full-size canvas, cropped', () => {
    const jezCtx = { south: 18.2110274, north: 18.7211945, west: 77.1604655, east: 77.6991776 }
    for (const centre of [{ latitude: 18.44, longitudeEast: 77.3 }, jezero]) {
      const frame = makeFrame(centre)
      const box = patchBox(frame, patchGrid(frame, 9))
      const area = clipBox(box, centre.longitudeEast, jezCtx)
      expect(area).not.toBeNull()
      if (!area) continue
      const p = areaPlacement(box, area, 2048)
      for (const tile of pickZoom(11, area, centre.longitudeEast, 1000).tiles) {
        const t = tileBounds(tile)
        const src = { west: t.west, width: t.width, north: t.north, south: t.south, pxWidth: 256, pxHeight: 256 }
        const small = equirectPieces(src, p.box, centre.longitudeEast, p.w, p.h)
        // The full canvas's pieces, cropped to the rectangle, in the rectangle's own pixels.
        const full = equirectPieces(src, box, centre.longitudeEast, 2048)
          .map((q) => cropPiece(q, p.x, p.y, p.w, p.h))
          .filter((q) => q !== null)
        expect(small.length).toBe(full.length)
        small.forEach((q, i) => {
          for (const k of ['sx', 'sy', 'sw', 'sh', 'dx', 'dy', 'dw', 'dh'] as const) expect(q[k]).toBeCloseTo(full[i]![k], 6)
        })
      }
    }
  })
})

/** A draw piece cut to the rectangle (x, y, w, h) of its destination, in that rectangle's pixels, source scaled to match. */
function cropPiece(q: DrawPiece, x: number, y: number, w: number, h: number): DrawPiece | null {
  const left = Math.max(q.dx, x)
  const right = Math.min(q.dx + q.dw, x + w)
  const top = Math.max(q.dy, y)
  const bottom = Math.min(q.dy + q.dh, y + h)
  if (right <= left || bottom <= top) return null
  const kx = q.sw / q.dw
  const ky = q.sh / q.dh
  return {
    sx: q.sx + (left - q.dx) * kx,
    sy: q.sy + (top - q.dy) * ky,
    sw: (right - left) * kx,
    sh: (bottom - top) * ky,
    dx: left - x,
    dy: top - y,
    dw: right - left,
    dh: bottom - top,
  }
}

describe('drawPatchImage wiring', () => {
  afterEach(() => vi.unstubAllGlobals())

  // Canvases that accept every 2D call; the test reads only sizes and which tiles each mosaic asked for.
  // Each canvas's height, in order, from the last stubCanvases(); its return value holds the widths.
  let heights: number[] = []
  function stubCanvases() {
    const sizes: number[] = []
    heights = []
    const ctx = new Proxy({}, { get: () => () => {}, set: () => true })
    vi.stubGlobal('document', {
      createElement: () => {
        const c = { width: 0, height: 0, getContext: () => ctx }
        return new Proxy(c, {
          set: (t, k, v) => {
            if (k === 'width') sizes.push(v as number)
            if (k === 'height') heights.push(v as number)
            return Reflect.set(t, k, v)
          },
        })
      },
    })
    vi.stubGlobal('requestAnimationFrame', () => 0)
    return sizes
  }

  function mosaic(id: string, tilePx: number, coverage: GroundImagery['coverage']) {
    const asked: string[] = []
    const imagery: GroundImagery = {
      detail: {
        layerId: id,
        maxZoom: 13,
        loadTile: async (zoom, row, col) => {
          asked.push(`${zoom}/${row}/${col}`)
          return { status: 'empty' }
        },
        resolutionAt: () => derived('fixture', 'fixture'),
      },
      tilePx,
      coverage,
      classification: 'OFFICIAL',
      label: id,
      credit: 'fixture',
      caveat: 'fixture',
      licence: 'fixture',
    }
    return { imagery, asked }
  }
  const jezCtxBox = { south: 18.2110274, north: 18.7211945, west: 77.1604655, east: 77.6991776 }

  it('gives each mosaic that meets the patch one entry, in order, with tiles from its own loader only', async () => {
    const sizes = stubCanvases()
    const global = mosaic('ctx', 512, null)
    const local = mosaic('jezero-ctx', 256, jezCtxBox)
    const img = drawPatchImage(jezeroBox, jezero.longitudeEast, null, null, [global.imagery, local.imagery], new AbortController().signal, () => {})
    expect(img.ground.map((g) => [g.imagery.detail.layerId, g.zoom])).toEqual([['ctx', 10], ['jezero-ctx', 11]])
    expect(img.ground.map((g) => g.total)).toEqual([global.asked.length, local.asked.length])
    expect(local.asked.every((t) => t.startsWith('11/'))).toBe(true)
    // Result, colour, the global mosaic over the whole patch, and Jezero CTX over its overlap only.
    const area = clipBox(jezeroBox, jezero.longitudeEast, jezCtxBox)
    expect(area).not.toBeNull()
    if (!area) return
    const jez = areaPlacement(jezeroBox, area, 2048)
    expect(sizes).toEqual([2048, 2048, 2048, jez.w])
    expect(heights).toEqual([2048, 2048, 2048, jez.h])
    expect(jez.w).toBeLessThan(2048)
    expect(await Promise.all(img.ground.map((g) => g.loaded))).toEqual([0, 0])
  })

  it('leaves out a mosaic the patch does not meet, and loads none of its tiles', () => {
    const sizes = stubCanvases()
    const global = mosaic('ctx', 512, null)
    const local = mosaic('jezero-ctx', 256, jezCtxBox)
    const img = drawPatchImage(galeBox, gale.longitudeEast, null, null, [global.imagery, local.imagery], new AbortController().signal, () => {})
    expect(img.ground.map((g) => g.imagery.detail.layerId)).toEqual(['ctx'])
    expect(local.asked).toEqual([])
    expect(sizes).toEqual([2048, 2048, 2048])
  })

  it('never draws a near-field mosaic into the patch, nor loads its tiles', () => {
    const sizes = stubCanvases()
    const global = mosaic('ctx', 512, null)
    const hirise = mosaic('jezero-hirise', 256, hiriseBox)
    const img = drawPatchImage(jezeroBox, jezero.longitudeEast, null, null, [global.imagery, { ...hirise.imagery, nearField: true }], new AbortController().signal, () => {})
    expect(img.ground.map((g) => g.imagery.detail.layerId)).toEqual(['ctx'])
    expect(hirise.asked).toEqual([])
    expect(sizes).toEqual([2048, 2048, 2048])
  })

  it('falls back to the 1024 px layer-only image when no mosaic meets the patch', () => {
    const sizes = stubCanvases()
    const local = mosaic('jezero-ctx', 256, jezCtxBox)
    const img = drawPatchImage(galeBox, gale.longitudeEast, null, null, [local.imagery], new AbortController().signal, () => {})
    expect(img.ground).toEqual([])
    expect(sizes).toEqual([1024])
  })
})
