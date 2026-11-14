import { describe, expect, it } from 'vitest'
import { marsSolarTime } from '../../src/domain'
import { planetPosition, solveKepler } from '../../src/features/mars-3d/sky/ephemeris'
import { skyAt, type SkyBody } from '../../src/features/mars-3d/sky/skyPositions'
import { HORIZONS_MARS_SKY } from '../fixtures/horizonsMarsSky'

const DEG = Math.PI / 180

function separationDeg(az1: number, el1: number, az2: number, el2: number): number {
  const cos =
    Math.sin(el1 * DEG) * Math.sin(el2 * DEG) +
    Math.cos(el1 * DEG) * Math.cos(el2 * DEG) * Math.cos((az1 - az2) * DEG)
  return Math.acos(Math.min(1, Math.max(-1, cos))) / DEG
}

function placed(body: SkyBody | undefined) {
  if (!body || body.placement.classification !== 'DERIVED') throw new Error('expected DERIVED')
  return body.placement.value
}

/**
 * How close to JPL Horizons each body must be, degrees. Near the equator
 * the budget is the published model errors, the moon fit (0.05° max) and
 * Horizons' apparent places (light time and aberration, under 0.01°): the
 * worst case measured is 0.10°. At 40° latitude Horizons measures elevation
 * from the ellipsoid normal and this app from the sphere's, which tilts the
 * whole sky by about 0.33° there (flattening × sin 2φ); measured, 0.33°.
 */
const toleranceDeg = (latitude: number) => (Math.abs(latitude) < 10 ? 0.12 : 0.36)

describe('skyAt against JPL Horizons, from the surface of Mars', () => {
  it.each(HORIZONS_MARS_SKY.map((r) => [`${r.body} ${r.label} at ${r.site.join(', ')}`, r] as const))(
    '%s',
    (_, ref) => {
      const sky = skyAt(ref.utcMs, { latitude: ref.site[1], longitudeEast: ref.site[0] })
      const p = placed(sky.find((b) => b.id === ref.body))
      expect(separationDeg(p.azimuthDeg, p.altitudeDeg, ref.az, ref.el)).toBeLessThan(toleranceDeg(ref.site[1]))
    },
  )
})

describe('skyAt', () => {
  it('puts the Sun overhead at the Mars24 subsolar point', () => {
    for (const utcMs of [Date.UTC(2025, 2, 10, 5, 30), Date.UTC(2026, 9, 23, 12), Date.UTC(2030, 0, 1)]) {
      const solar = marsSolarTime(utcMs)
      if (solar.classification !== 'DERIVED') throw new Error('expected DERIVED')
      const sun = placed(skyAt(utcMs, solar.value.subsolarPoint).find((b) => b.id === 'sun'))
      // Mars24 (which lights the globe) and the JPL elements are independent
      // models; measured, they agree within 0.25°, under one Sun-width.
      expect(sun.altitudeDeg).toBeGreaterThan(89.7)
    }
  })

  it('sizes the Sun at about a third of a degree, and Earth far smaller', () => {
    const sky = skyAt(Date.UTC(2026, 9, 23, 12), { latitude: 0, longitudeEast: 0 })
    const sun = placed(sky.find((b) => b.id === 'sun'))
    const earth = placed(sky.find((b) => b.id === 'earth'))
    expect((2 * sun.angularRadius) / DEG).toBeGreaterThan(0.3)
    expect((2 * sun.angularRadius) / DEG).toBeLessThan(0.42)
    expect(earth.angularRadius).toBeLessThan(sun.angularRadius / 20)
  })

  it('hides Phobos from high latitudes, where it never rises', () => {
    for (let h = 0; h < 24; h += 1) {
      const sky = skyAt(Date.UTC(2026, 9, 23, h), { latitude: 80, longitudeEast: 30 })
      expect(placed(sky.find((b) => b.id === 'phobos')).altitudeDeg).toBeLessThan(0)
    }
  })

  it('puts Phobos in Mars’s shadow for part of each orbit, and never the Sun-facing part', () => {
    const states: boolean[] = []
    const start = Date.UTC(2026, 9, 27)
    for (let m = 0; m < 460; m += 5) {
      const sky = skyAt(start + m * 60000, { latitude: 0, longitudeEast: 0 })
      states.push(placed(sky.find((b) => b.id === 'phobos')).inMarsShadow === true)
    }
    expect(states.some(Boolean)).toBe(true)
    expect(states.some((s) => !s)).toBe(true)
    // Overhead at the subsolar point, Phobos is between Mars and the Sun: never eclipsed.
    const noon = Date.UTC(2026, 9, 27, 3)
    const solar = marsSolarTime(noon)
    if (solar.classification !== 'DERIVED') throw new Error('expected DERIVED')
    const sky = skyAt(noon, solar.value.subsolarPoint)
    const phobos = placed(sky.find((b) => b.id === 'phobos'))
    if (phobos.altitudeDeg > 60) expect(phobos.inMarsShadow).toBe(false)
  })

  it('marks the moons UNAVAILABLE outside their fitted window, planets outside 1800–2050', () => {
    const late = skyAt(Date.UTC(2040, 0, 1), { latitude: 0, longitudeEast: 0 })
    expect(late.find((b) => b.id === 'phobos')?.placement.classification).toBe('UNAVAILABLE')
    expect(late.find((b) => b.id === 'jupiter')?.placement.classification).toBe('DERIVED')
    const later = skyAt(Date.UTC(2060, 0, 1), { latitude: 0, longitudeEast: 0 })
    expect(later.every((b) => b.placement.classification === 'UNAVAILABLE')).toBe(true)
  })

  it('states the method of every DERIVED placement', () => {
    for (const body of skyAt(Date.UTC(2026, 9, 23, 12), { latitude: 10, longitudeEast: 200 })) {
      if (body.placement.classification === 'DERIVED') expect(body.placement.method).toMatch(/JPL/)
    }
  })
})

describe('ephemeris building blocks', () => {
  it('solves Kepler’s equation', () => {
    for (const [M, e] of [
      [0.3, 0.0934],
      [3, 0.2056],
      [-2, 0.0167],
    ]) {
      const E = solveKepler(M, e)
      expect(E - e * Math.sin(E)).toBeCloseTo(M, 12)
    }
  })

  it('places Mars about 1.38–1.67 au from the Sun', () => {
    const p = planetPosition('mars', 2461337)
    const au = Math.hypot(...p) / 149597870.7
    expect(au).toBeGreaterThan(1.38)
    expect(au).toBeLessThan(1.67)
  })
})
