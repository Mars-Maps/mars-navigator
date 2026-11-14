import { describe, expect, it } from 'vitest'
import { coordinateToScreen, patchBounds, placements } from '../../src/features/mars-3d/surfaceView/overheadMapView'
import { drawWalker } from '../../src/features/mars-3d/surfaceView/walkerMarker'
import { boxUv, isPolarBox, makeFrame, patchBox, patchGrid, GROUND_GRID_FOR_TESTS } from './minimap.helpers'

describe('boxUv', () => {
  it('puts the patch centre in the middle and the edges at 0 and 1', () => {
    const frame = makeFrame({ latitude: 20, longitudeEast: 100 })
    const box = patchBox(frame, patchGrid(frame, GROUND_GRID_FOR_TESTS))
    const centre = boxUv(box, 100, 20, 100)
    expect(centre.u).toBeCloseTo(0.5, 2)
    expect(centre.v).toBeCloseTo(0.5, 2)
    expect(boxUv(box, 100, box.south, 100).v).toBe(0)
    expect(boxUv(box, 100, box.north, 100).v).toBe(1)
    expect(boxUv(box, 100, 20, 100 + box.westRel).u).toBe(0)
    expect(boxUv(box, 100, 20, 100 + box.eastRel).u).toBe(1)
  })

  it('tells a box over a pole, where the flat north-up map does not apply, from one that is not', () => {
    const polar = makeFrame({ latitude: 89.9, longitudeEast: 30 })
    expect(isPolarBox(patchBox(polar, patchGrid(polar, GROUND_GRID_FOR_TESTS)))).toBe(true)
    const mid = makeFrame({ latitude: 60, longitudeEast: 30 })
    expect(isPolarBox(patchBox(mid, patchGrid(mid, GROUND_GRID_FOR_TESTS)))).toBe(false)
  })

  it('is continuous across the 0/360°E seam', () => {
    const frame = makeFrame({ latitude: -10, longitudeEast: 0 })
    const box = patchBox(frame, patchGrid(frame, GROUND_GRID_FOR_TESTS))
    const west = boxUv(box, 0, -10, 359.9)
    const east = boxUv(box, 0, -10, 0.1)
    expect(west.u).toBeLessThan(0.5)
    expect(east.u).toBeGreaterThan(0.5)
    expect(east.u - west.u).toBeCloseTo(0.2 / (box.eastRel - box.westRel), 6)
  })

  it('matches the texture mapping the ground uses, at every grid vertex', () => {
    const frame = makeFrame({ latitude: 60, longitudeEast: 350 })
    const points = patchGrid(frame, 9)
    const box = patchBox(frame, points)
    for (let i = 0; i < points.length; i += 2) {
      const { u, v } = boxUv(box, 350, points[i], points[i + 1])
      expect(u).toBeGreaterThanOrEqual(-1e-9)
      expect(u).toBeLessThanOrEqual(1 + 1e-9)
      expect(v).toBeGreaterThanOrEqual(-1e-9)
      expect(v).toBeLessThanOrEqual(1 + 1e-9)
    }
  })
})

describe('patchBounds', () => {
  it('lays the patch picture on the map grid where boxUv says its pixels are', () => {
    for (const centre of [{ latitude: 20, longitudeEast: 100 }, { latitude: -10, longitudeEast: 0 }, { latitude: 60, longitudeEast: 359.9 }]) {
      const frame = makeFrame(centre)
      const box = patchBox(frame, patchGrid(frame, GROUND_GRID_FOR_TESTS))
      const bounds = patchBounds(box, centre.longitudeEast)
      const view = { centre, pxPerDeg: 400 }
      const size = { width: 300, height: 300 }
      const [p] = placements(view, size, bounds)
      // A point inside the patch: its place in the picture and on the map agree.
      const at = { latitude: centre.latitude + 0.05, longitudeEast: (centre.longitudeEast + 0.07) % 360 }
      const { u, v } = boxUv(box, centre.longitudeEast, at.latitude, at.longitudeEast)
      const onMap = coordinateToScreen(view, size, at)
      expect(p.x + u * p.w).toBeCloseTo(onMap.x, 6)
      expect(p.y + (1 - v) * p.h).toBeCloseTo(onMap.y, 6)
    }
  })
})

describe('drawWalker', () => {
  // A recording context: the test checks what is asked of the canvas, not pixels.
  function recorder() {
    const calls: string[] = []
    const ctx = new Proxy({} as CanvasRenderingContext2D, {
      get: (_t, name: string) => (...args: unknown[]) => calls.push(`${name}(${args.map((a) => (typeof a === 'number' && !Number.isInteger(a) ? a.toFixed(2) : String(a))).join(',')})`),
      set: (_t, name: string, value: unknown) => {
        calls.push(`${name}=${String(value)}`)
        return true
      },
    })
    return { ctx, calls }
  }

  it('draws the dot and the look wedge at the point, turned to the yaw, and restores the context', () => {
    const { ctx, calls } = recorder()
    drawWalker(ctx, 100, 50, 1.2)
    expect(calls[0]).toBe('save()')
    expect(calls).toContain('translate(100,50)')
    expect(calls).toContain('rotate(1.20)')
    expect(calls.filter((c) => c.startsWith('arc(')).length).toBe(2)
    expect(calls[calls.length - 1]).toBe('restore()')
  })
})
