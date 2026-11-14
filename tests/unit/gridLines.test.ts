import { describe, expect, it } from 'vitest'
import { Vector3 } from 'three'
import {
  GRID_LEVELS,
  buildGridLines,
  levelFade,
} from '../../src/features/mars-3d/gridLines'
import { localPointToCoordinate } from '../../src/features/mars-3d/projection'

const R = 3.3895

/** Every vertex of a grid as a surface coordinate. */
function coordinates(positions: Float32Array) {
  const out = []
  const p = new Vector3()
  for (let i = 0; i < positions.length; i += 3) {
    p.set(positions[i], positions[i + 1], positions[i + 2])
    out.push(localPointToCoordinate(p, R))
  }
  return out
}

/** Longitude difference across the 0/360 seam, degrees. */
function lonDiff(a: number, b: number) {
  const d = Math.abs(a - b) % 360
  return Math.min(d, 360 - d)
}

describe('gridLines: buildGridLines', () => {
  it('puts every vertex on the sphere at the given radius', () => {
    const positions = buildGridLines(30, null, R)
    for (let i = 0; i < positions.length; i += 3) {
      const length = Math.hypot(positions[i], positions[i + 1], positions[i + 2])
      expect(length).toBeCloseTo(R, 4)
    }
  })

  it('draws whole segments: two vertices of three floats each', () => {
    expect(buildGridLines(30, null, R).length % 6).toBe(0)
  })

  it('places the 0°E meridian at longitude 0 through the projection', () => {
    const coords = coordinates(buildGridLines(30, null, R))
    // Off the poles, where longitude is undefined.
    const onPrime = coords.filter(
      (c) => Math.abs(c.latitude) < 89 && lonDiff(c.longitudeEast, 0) < 1e-3,
    )
    expect(onPrime.length).toBeGreaterThan(0)
  })

  it('draws parallels at every step except the poles', () => {
    const coords = coordinates(buildGridLines(30, null, R))
    const latitudes = new Set(
      coords
        .map((c) => Math.round(c.latitude * 1000) / 1000)
        .filter((lat) => lat % 30 === 0 && Math.abs(lat) < 90),
    )
    expect([...latitudes].sort((a, b) => a - b)).toEqual([-60, -30, 0, 30, 60])
  })

  it('never redraws a line the coarser level already draws', () => {
    // On a 10° grid that skips 30°, no meridian vertex lies on a 30° meridian
    // and no parallel sits at 0° or ±30°/±60°.
    const positions = buildGridLines(10, 30, R)
    const coords = coordinates(positions)
    for (let i = 0; i < coords.length; i += 2) {
      const a = coords[i]
      const b = coords[i + 1]
      const isParallel = Math.abs(a.latitude - b.latitude) < 1e-6
      if (isParallel) {
        expect(Math.round(a.latitude) % 30).not.toBe(0)
      } else if (Math.abs(a.latitude) < 89) {
        expect(Math.round(a.longitudeEast) % 30).not.toBe(0)
      }
    }
  })

  it('makes each level a strict refinement of the one before', () => {
    for (let i = 1; i < GRID_LEVELS.length; i++) {
      const coarse = GRID_LEVELS[i - 1]
      const fine = GRID_LEVELS[i]
      expect(coarse.stepDeg % fine.stepDeg).toBe(0)
      expect(fine.maxAltitudeKm).toBeLessThan(coarse.maxAltitudeKm)
      expect(fine.opacity).toBeLessThan(coarse.opacity)
    }
  })
})

describe('gridLines: levelFade', () => {
  it('is fully visible at or below the threshold', () => {
    expect(levelFade(500, 700)).toBe(1)
    expect(levelFade(700, 700)).toBe(1)
  })

  it('is hidden well above the threshold', () => {
    expect(levelFade(1050, 700)).toBe(0)
    expect(levelFade(20000, 700)).toBe(0)
  })

  it('fades linearly in between', () => {
    expect(levelFade(875, 700)).toBeCloseTo(0.5, 10)
  })

  it('always shows a level with no threshold', () => {
    expect(levelFade(25000, Infinity)).toBe(1)
  })
})
