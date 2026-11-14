import { describe, expect, it } from 'vitest'
import { MARS_MEAN_RADIUS_KM, simulated, unavailable, type MarsCoordinate } from '../../src/domain'
import { buildGroundPatch, GROUND_GRID } from '../../src/features/mars-3d/surfaceView/groundPatch'
import { sampleHeight } from '../../src/features/mars-3d/surfaceView/heightfield'
import { boxTiles, composePatch, equirectPieces, pickZoom } from '../../src/features/mars-3d/surfaceView/patchImage'
import {
  simulatedElevation,
  SIMULATED_ELEVATION_SOURCE,
} from '../../src/features/mars-3d/surfaceView/simulatedElevation'
import {
  makeFrame,
  patchBox,
  patchGrid,
  PATCH_HALF_KM,
  relativeLongitude,
  toCoordinate,
  toPatch,
} from '../../src/features/mars-3d/surfaceView/surfacePatch'
import { tileBounds } from '../../src/features/mars-3d/tilePyramid'

const RAD = Math.PI / 180

function greatCircleKm(a: MarsCoordinate, b: MarsCoordinate): number {
  const p1 = a.latitude * RAD
  const p2 = b.latitude * RAD
  const dl = (b.longitudeEast - a.longitudeEast) * RAD
  const cos = Math.sin(p1) * Math.sin(p2) + Math.cos(p1) * Math.cos(p2) * Math.cos(dl)
  return Math.acos(Math.min(1, Math.max(-1, cos))) * MARS_MEAN_RADIUS_KM
}

const CENTRES: [string, MarsCoordinate][] = [
  ['the equator', { latitude: 0, longitudeEast: 10 }],
  ['mid-latitude', { latitude: -42.5, longitudeEast: 250 }],
  ['the 180°E line', { latitude: 12, longitudeEast: 180 }],
  ['0°E', { latitude: -5, longitudeEast: 0.01 }],
  ['the north pole', { latitude: 90, longitudeEast: 0 }],
  ['the south pole', { latitude: -90, longitudeEast: 77 }],
]

describe('surface patch projection', () => {
  it.each(CENTRES)('round-trips offsets at %s', (_, centre) => {
    const frame = makeFrame(centre)
    for (const [x, y] of [
      [0, 0],
      [12.5, -7],
      [-PATCH_HALF_KM, PATCH_HALF_KM],
      [300, 40],
    ]) {
      const back = toPatch(frame, toCoordinate(frame, x, y))
      expect(back.xKm).toBeCloseTo(x, 6)
      expect(back.yKm).toBeCloseTo(y, 6)
    }
  })

  it.each(CENTRES)('keeps true distance from the centre at %s', (_, centre) => {
    const frame = makeFrame(centre)
    const p = toCoordinate(frame, 15, -11)
    expect(greatCircleKm(centre, p)).toBeCloseTo(Math.hypot(15, -11), 6)
  })

  it('points x east and y north away from the poles', () => {
    const frame = makeFrame({ latitude: 20, longitudeEast: 100 })
    const east = toCoordinate(frame, 10, 0)
    const north = toCoordinate(frame, 0, 10)
    expect(east.longitudeEast).toBeGreaterThan(100)
    expect(east.latitude).toBeCloseTo(20, 1)
    expect(north.latitude).toBeGreaterThan(20)
    expect(north.longitudeEast).toBeCloseTo(100, 6)
  })

  it('crosses the 180°E line into the 0–360 range', () => {
    const frame = makeFrame({ latitude: 0, longitudeEast: 179.9 })
    const p = toCoordinate(frame, 20, 0)
    expect(p.longitudeEast).toBeGreaterThan(180)
    expect(p.longitudeEast).toBeLessThan(181)
    const q = toCoordinate(makeFrame({ latitude: 0, longitudeEast: 0.1 }), -20, 0)
    expect(q.longitudeEast).toBeGreaterThan(359)
    expect(q.longitudeEast).toBeLessThan(360)
  })

  it('lists grid points row 0 north and column 0 west', () => {
    const frame = makeFrame({ latitude: 10, longitudeEast: 50 })
    const g = patchGrid(frame, 5)
    expect(g.length).toBe(50)
    expect(g[0]).toBeGreaterThan(g[(4 * 5) * 2]) // north row above south row
    expect(g[1]).toBeLessThan(g[4 * 2 + 1]) // west column left of east column
    expect(g[(2 * 5 + 2) * 2]).toBeCloseTo(10, 9) // centre
  })

  it('measures relative longitude the short way round', () => {
    expect(relativeLongitude(1, 359)).toBeCloseTo(2, 9)
    expect(relativeLongitude(359, 1)).toBeCloseTo(-2, 9)
    expect(relativeLongitude(180, 0)).toBe(180)
  })

  it('boxes a patch on the 180°E line as one narrow box', () => {
    const frame = makeFrame({ latitude: 0, longitudeEast: 180 })
    const box = patchBox(frame, patchGrid(frame, 9))
    expect(box.westRel).toBeLessThan(0)
    expect(box.eastRel).toBeGreaterThan(0)
    expect(box.eastRel - box.westRel).toBeLessThan(2)
  })

  it('boxes a patch over a pole as every longitude, up to the pole', () => {
    const frame = makeFrame({ latitude: 89.9, longitudeEast: 30 })
    const box = patchBox(frame, patchGrid(frame, 9))
    expect(box.north).toBe(90)
    expect(box.westRel).toBe(-180)
    expect(box.eastRel).toBe(180)
  })
})

describe('patch imagery placement', () => {
  const globe = { west: 180, width: 360, north: 90, south: -90, pxWidth: 3600, pxHeight: 1800 }

  it('splits the whole-globe image where a box crosses its 180°E edge', () => {
    const box = { south: -1, north: 1, westRel: -0.5, eastRel: 0.5 }
    const pieces = equirectPieces(globe, box, 180, 1000)
    expect(pieces).toHaveLength(2)
    expect(pieces.reduce((sum, p) => sum + p.dw, 0)).toBeCloseTo(1000, 6)
    for (const p of pieces) {
      expect(p.dy).toBeCloseTo(0, 6)
      expect(p.dh).toBeCloseTo(1000, 6)
    }
  })

  it('places one piece for a box away from the edge', () => {
    const box = { south: 10, north: 12, westRel: -1, eastRel: 1 }
    const [p, ...rest] = equirectPieces(globe, box, 90, 1000)
    expect(rest).toHaveLength(0)
    expect(p.sx).toBeCloseTo((89 - 180 + 360) * 10, 6)
    expect(p.sy).toBeCloseTo((90 - 12) * 10, 6)
    expect(p.sw).toBeCloseTo(20, 6)
  })

  it('lists tiles on both sides of the 180°E line', () => {
    const box = { south: -0.2, north: 0.2, westRel: -0.3, eastRel: 0.3 }
    const tiles = boxTiles(7, box, 180).map(tileBounds)
    const wests = tiles.map((b) => b.west)
    expect(Math.max(...wests)).toBeGreaterThan(179)
    expect(Math.min(...wests)).toBeLessThan(180.0001)
    expect(tiles.some((b) => b.west + b.width > 180 && b.west < 180)).toBe(false)
  })
})

describe('ground imagery composition', () => {
  const equatorBox = patchBox(makeFrame({ latitude: 0, longitudeEast: 10 }), patchGrid(makeFrame({ latitude: 0, longitudeEast: 10 }), 9))
  const highBox = patchBox(makeFrame({ latitude: 70, longitudeEast: 10 }), patchGrid(makeFrame({ latitude: 70, longitudeEast: 10 }), 9))

  it('picks the finest zoom whose tiles fit the budget, and never goes below zoom 3', () => {
    const eq = pickZoom(10, equatorBox, 10, 40)
    expect(eq.zoom).toBe(10)
    expect(eq.tiles.length).toBeLessThanOrEqual(40)
    expect(eq.tiles.length).toBeGreaterThanOrEqual(16)
    expect(eq.tiles.every((t) => t.zoom === 10)).toBe(true)
    // A 40 km box at 70° spans many more columns: the budget forces a coarser zoom.
    const high = pickZoom(10, highBox, 10, 40)
    expect(high.zoom).toBeLessThan(10)
    expect(high.tiles.length).toBeLessThanOrEqual(40)
    // No budget at all still stops at zoom 3.
    expect(pickZoom(10, highBox, 10, 0).zoom).toBe(3)
  })

  it('composes the colour, then the brightness in luminosity mode, over the no-data fill', () => {
    const calls: string[] = []
    const ctx = new Proxy({} as CanvasRenderingContext2D, {
      get: (_t, name: string) => (...args: unknown[]) => calls.push(`${name}(${args.map(String).join(',')})`),
      set: (_t, name: string, value: unknown) => {
        calls.push(`${name}=${String(value)}`)
        return true
      },
    })
    const colour = { id: 'colour' } as unknown as HTMLCanvasElement
    const lum = { toString: () => 'lum' } as unknown as HTMLCanvasElement
    composePatch(ctx, colour, [{ image: lum, x: 0, y: 0, w: 2048, h: 2048 }], 2048)
    expect(calls).toEqual([
      'globalCompositeOperation=source-over',
      'fillStyle=#2a2622',
      'fillRect(0,0,2048,2048)',
      'drawImage([object Object],0,0,2048,2048)',
      'globalCompositeOperation=luminosity',
      'drawImage(lum,0,0,2048,2048)',
      'globalCompositeOperation=source-over',
    ])
  })
})

describe('simulated elevation (SIMULATED)', () => {
  const signal = new AbortController().signal

  it('is labelled SIMULATED with its source', async () => {
    const h = await simulatedElevation.sample(new Float64Array([0, 0]), signal)
    expect(h.classification).toBe('SIMULATED')
    if (h.classification === 'SIMULATED') expect(h.source).toBe(SIMULATED_ELEVATION_SOURCE)
  })

  it('gives the same height for the same place whichever patch asks', async () => {
    const place: MarsCoordinate = { latitude: -4.6, longitudeEast: 137.4 }
    const a = makeFrame(place)
    const b = makeFrame({ latitude: -4.65, longitudeEast: 137.47 })
    const viaB = toCoordinate(b, toPatch(b, place).xKm, toPatch(b, place).yKm)
    const h = await simulatedElevation.sample(
      new Float64Array([place.latitude, place.longitudeEast, viaB.latitude, viaB.longitudeEast]),
      signal,
    )
    if (h.classification !== 'SIMULATED') throw new Error('expected SIMULATED')
    expect(h.value[1]).toBeCloseTo(h.value[0], 2)
    expect(toPatch(a, place).xKm).toBeCloseTo(0, 9)
  })

  it('is finite everywhere, poles and the 180°E line included', async () => {
    const pts = new Float64Array([90, 0, -90, 0, 0, 180, 0, 0, 45, 359.999, -30, 180.0001])
    const h = await simulatedElevation.sample(pts, signal)
    if (h.classification !== 'SIMULATED') throw new Error('expected SIMULATED')
    expect(Array.from(h.value).every(Number.isFinite)).toBe(true)
  })

  it('has relief: heights over a patch are not all equal', async () => {
    const frame = makeFrame({ latitude: 18.4, longitudeEast: 77.5 })
    const h = await simulatedElevation.sample(patchGrid(frame, 17), signal)
    if (h.classification !== 'SIMULATED') throw new Error('expected SIMULATED')
    expect(Math.max(...h.value) - Math.min(...h.value)).toBeGreaterThan(5)
  })
})

describe('ground heightfield sampling', () => {
  const size = 5
  const heights = Float32Array.from({ length: size * size }, (_, i) => (i * 37) % 11)
  const field = { heights, size, spacingM: 100 }

  it('returns the vertex height at every vertex', () => {
    for (let row = 0; row < size; row++) {
      for (let col = 0; col < size; col++) {
        const h = sampleHeight(field, col * 100 - 200, 200 - row * 100)
        expect(h).toBeCloseTo(heights[row * size + col], 4)
      }
    }
  })

  it('clamps outside the field', () => {
    expect(sampleHeight(field, -1e6, 1e6)).toBeCloseTo(heights[0], 4)
  })
})

describe('buildGroundPatch', () => {
  const sources = (sample: () => Promise<ReturnType<typeof unavailable<Float32Array>>>) => ({
    elevation: { sample },
    detail: null,
    groundImagery: [],
    globeImage: null,
    maxAnisotropy: 1,
  })

  it('builds nothing and passes the reason on when heights are UNAVAILABLE', async () => {
    const r = await buildGroundPatch(
      { latitude: 0, longitudeEast: 0 },
      sources(async () => unavailable('No DEM coverage here')),
      new AbortController().signal,
    )
    expect(r).toEqual({ status: 'unavailable', reason: 'No DEM coverage here' })
  })

  it('refuses a height list of the wrong length', async () => {
    const r = await buildGroundPatch(
      { latitude: 0, longitudeEast: 0 },
      sources(async () => simulated(new Float32Array(3), 'test')),
      new AbortController().signal,
    )
    expect(r.status).toBe('unavailable')
  })

  it('reports an abort instead of building', async () => {
    const controller = new AbortController()
    controller.abort()
    const r = await buildGroundPatch(
      { latitude: 0, longitudeEast: 0 },
      sources(async () => simulated(new Float32Array(GROUND_GRID * GROUND_GRID), 'test')),
      controller.signal,
    )
    expect(r.status).toBe('aborted')
  })
})
