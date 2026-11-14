import { describe, expect, it } from 'vitest'
import { Mesh, MeshBasicMaterial, Points, ShaderMaterial, Texture, Group, BufferGeometry } from 'three'
import { FrameSampler } from '../../src/features/mars-3d/frameStats'
import { collectTextures } from '../../src/features/mars-3d/perfReport'
import { PERF_ROUTE_POINTS, perfTestRoute } from '../../src/features/mars-3d/perfRoute'
import { validateCoordinate } from '../../src/domain'

describe('FrameSampler', () => {
  it('has no summary before any sample, rather than a frame time of zero', () => {
    expect(new FrameSampler().summary()).toBeNull()
  })

  it('reports mean, nearest-rank p95 and max', () => {
    const s = new FrameSampler(100)
    for (let i = 1; i <= 100; i++) s.record(i)
    const sum = s.summary()!
    expect(sum.count).toBe(100)
    expect(sum.meanMs).toBeCloseTo(50.5)
    expect(sum.p95Ms).toBe(95)
    expect(sum.maxMs).toBe(100)
    expect(sum.fps).toBeCloseTo(1000 / 50.5)
  })

  it('keeps only the most recent samples once full', () => {
    const s = new FrameSampler(3)
    for (const ms of [100, 100, 10, 20, 30]) s.record(ms)
    const sum = s.summary()!
    expect(sum.count).toBe(3)
    expect(sum.maxMs).toBe(30)
    expect(sum.meanMs).toBeCloseTo(20)
  })

  it('drops non-finite and negative samples', () => {
    const s = new FrameSampler()
    s.record(Number.NaN)
    s.record(Infinity)
    s.record(-1)
    expect(s.summary()).toBeNull()
    s.record(16)
    expect(s.summary()!.count).toBe(1)
  })

  it('forgets everything on reset', () => {
    const s = new FrameSampler()
    s.record(16)
    s.reset()
    expect(s.summary()).toBeNull()
  })
})

describe('perfTestRoute', () => {
  it('has the requested number of waypoints, ends included', () => {
    const r = perfTestRoute()
    expect(r.stops.length + 2).toBe(PERF_ROUTE_POINTS)
    expect(perfTestRoute(2).stops).toEqual([])
    expect(perfTestRoute(1).stops).toEqual([])
  })

  it('gives only valid coordinates, longitudes wrapped into 0–360', () => {
    const r = perfTestRoute(400)
    for (const c of [r.departure, ...r.stops, r.destination]) {
      expect(validateCoordinate(c)).toEqual({ ok: true })
      expect(c.longitudeEast).toBeGreaterThanOrEqual(0)
      expect(c.longitudeEast).toBeLessThan(360)
    }
  })

  it('is deterministic, so every machine measures the same route', () => {
    expect(perfTestRoute()).toEqual(perfTestRoute())
  })
})

function sized(width: number, height: number): Texture {
  const t = new Texture({ width, height } as unknown as HTMLImageElement)
  return t
}

describe('collectTextures', () => {
  it('finds material maps and shader uniforms, each texture once', () => {
    const shared = sized(256, 256)
    const root = new Group()
    root.add(new Mesh(new BufferGeometry(), new MeshBasicMaterial({ map: shared })))
    root.add(new Mesh(new BufferGeometry(), new MeshBasicMaterial({ map: shared })))
    const uniform = sized(64, 64)
    uniform.generateMipmaps = false
    root.add(new Points(new BufferGeometry(), new ShaderMaterial({ uniforms: { uMap: { value: uniform } } })))

    const rows = collectTextures(root)
    expect(rows).toHaveLength(2)
    const big = rows.find((r) => r.width === 256)!
    expect(big.mipmaps).toBe(true)
    expect(big.estimatedBytes).toBe(Math.round(256 * 256 * 4 * (4 / 3)))
    const small = rows.find((r) => r.width === 64)!
    expect(small.owner).toBe('Points')
    expect(small.estimatedBytes).toBe(64 * 64 * 4)
  })

  it('reports nothing for a scene without textures', () => {
    const root = new Group()
    root.add(new Mesh(new BufferGeometry(), new MeshBasicMaterial({ color: 0xffffff })))
    expect(collectTextures(root)).toEqual([])
  })
})
