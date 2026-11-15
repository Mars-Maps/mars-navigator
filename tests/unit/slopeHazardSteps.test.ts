import { describe, expect, it } from 'vitest'
import { isAvailable, official, type MarsCoordinate, type RouteRequest, type SurfacePoint } from '../../src/domain'
import { routeSlopeHazards } from '../../src/features/route-analysis/slopeHazard'
import { planFastest } from '../../src/features/route-analysis/strategies/fastest'
import { at, fixtureTerrain } from './terrain.helpers'

// The review of the steep slope scan: steep ground inside a straight run, the 0°/360°E middle, a stop on its own node.
const signal = new AbortController().signal
const slopeHazards = (hazards: Awaited<ReturnType<typeof planFastest>>['hazards']) => {
  if (!isAvailable(hazards)) throw new Error(`Not scanned: ${hazards.reason}`)
  return hazards.value.filter((h) => h.kind === 'slope')
}

describe('the slope scan of a searched route looks at every step', () => {
  /** A V-notch 400 m wide across the route, its two sides at `deg`: the path crosses it without turning. */
  const notch = (deg: number) => (x: number) => Math.max(0, 0.2 - Math.abs(x - 0.5)) * -1000 * Math.tan((deg * Math.PI) / 180)
  const request: RouteRequest = { departure: at(0, 0), stops: [], destination: at(1, 0) }

  // A 19° notch is not here: the fastest path crosses it on the diagonal, where no step reaches 15°.
  for (const deg of [17, 18]) {
    it(`warns of a ${deg}° notch crossed on a straight heading`, async () => {
      const option = await planFastest(request, fixtureTerrain(notch(deg)), signal)
      if (!isAvailable(option.path)) throw new Error(option.path.reason)
      const found = slopeHazards(option.hazards)
      expect(found.length).toBeGreaterThan(0)
      const steepest = Math.max(...found.map((h) => (isAvailable(h.magnitude) ? h.magnitude.value : 0)))
      expect(steepest).toBeGreaterThan(deg - 0.5)
      expect(steepest).toBeLessThan(deg + 0.5)
    })
  }

  it('finds none on level ground, and says the scan ran', async () => {
    const option = await planFastest(request, fixtureTerrain(() => 0), signal)
    expect(slopeHazards(option.hazards)).toEqual([])
    expect(option.hazards.classification === 'DERIVED' && option.hazards.method).toContain('Scanned for slope: ')
  })
})

describe('routeSlopeHazards', () => {
  const point = (id: string, coordinate: MarsCoordinate, heightM: number): SurfacePoint => ({
    id,
    coordinate,
    elevationMeters: official(heightM, 'fixture height'),
  })

  it('puts the warning of a stretch across 0°/360°E between its ends, not at 180°E', () => {
    const hazards = routeSlopeHazards([
      point('a', { latitude: 0, longitudeEast: 359.999 }, 0),
      point('b', { latitude: 0, longitudeEast: 0.001 }, 40),
    ])
    if (!isAvailable(hazards)) throw new Error(hazards.reason)
    expect(hazards.value).toHaveLength(1)
    const lon = hazards.value[0].coordinate.longitudeEast
    expect(Math.min(lon, 360 - lon)).toBeLessThan(0.001)
  })

  it('keeps one warning for a steep run with a stretch of no length inside it', () => {
    const hazards = routeSlopeHazards([
      point('a', at(0), 0),
      point('b', at(0.1), 30),
      point('b again', at(0.1), 30),
      point('c', at(0.2), 60),
    ])
    if (!isAvailable(hazards)) throw new Error(hazards.reason)
    expect(hazards.value).toHaveLength(1)
  })
})
