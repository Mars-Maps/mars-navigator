import { describe, expect, it } from 'vitest'
import { LANDING_VIEW_CELLS, LANDING_VIEW_MAX_KM, landingViewBox } from '../../src/app/landingViewBox'
import { MARS_MEAN_RADIUS_KM } from '../../src/domain'
import { landingLattice } from '../../src/features/route-analysis/landingLattice'

const SCREEN = { fovDeg: 25, aspect: 16 / 9 }
const KM_PER_DEG = (MARS_MEAN_RADIUS_KM * Math.PI) / 180
const JEZERO = { latitude: 18.466, longitudeEast: 77.43 }

describe('the box the landing rating is worked on for a view', () => {
  it('is centred on the view, not on a site: the colours follow the camera', () => {
    const here = landingViewBox({ altitudeKm: 300, target: JEZERO }, SCREEN, 0.41)!
    const there = landingViewBox({ altitudeKm: 300, target: { latitude: -4.6, longitudeEast: 137.4 } }, SCREEN, 0.41)!
    expect((here.bounds.south + here.bounds.north) / 2).toBeCloseTo(JEZERO.latitude, 9)
    expect((here.bounds.west + here.bounds.east) / 2).toBeCloseTo(JEZERO.longitudeEast, 9)
    expect((there.bounds.south + there.bounds.north) / 2).toBeCloseTo(-4.6, 9)
    expect((there.bounds.west + there.bounds.east) / 2).toBeCloseTo(137.4, 9)
  })

  it('holds everything on screen: at least the ground from the centre to the screen’s corner, every way', () => {
    const altitudeKm = 300
    const { bounds } = landingViewBox({ altitudeKm, target: JEZERO }, SCREEN, 0.41)!
    // Flat-ground estimate of the corner's distance, which the sphere only lengthens.
    const cornerKm = altitudeKm * Math.tan((12.5 * Math.PI) / 180) * Math.hypot(1, SCREEN.aspect)
    expect(((bounds.north - bounds.south) / 2) * KM_PER_DEG).toBeGreaterThan(cornerKm)
    const narrowest = Math.cos((bounds.north * Math.PI) / 180)
    expect(((bounds.east - bounds.west) / 2) * KM_PER_DEG * narrowest).toBeGreaterThan(cornerKm)
  })

  it('grows with the camera’s height and keeps the cell count, so a view costs what the site’s sheet did', () => {
    const low = landingViewBox({ altitudeKm: 150, target: JEZERO }, SCREEN, 0.41)!
    const high = landingViewBox({ altitudeKm: 600, target: JEZERO }, SCREEN, 0.41)!
    expect(high.bounds.north - high.bounds.south).toBeGreaterThan((low.bounds.north - low.bounds.south) * 3.5)
    expect(high.spacingKm).toBeGreaterThan(low.spacingKm * 3.5)
    for (const box of [low, high]) {
      const lattice = landingLattice(box.bounds, box.spacingKm)!
      expect(lattice.rows).toBeLessThanOrEqual(LANDING_VIEW_CELLS)
      expect(lattice.cols).toBeLessThanOrEqual(LANDING_VIEW_CELLS)
      expect(lattice.rows).toBeGreaterThan(LANDING_VIEW_CELLS * 0.9)
    }
  })

  it('never lays the lattice finer than the least spacing, however close the camera', () => {
    const box = landingViewBox({ altitudeKm: 40, target: JEZERO }, SCREEN, 0.41)!
    expect(box.spacingKm).toBe(0.41)
    expect(landingLattice(box.bounds, box.spacingKm)).not.toBeNull()
  })

  it('gives no box for a view wider than the widest rated, so the caller keeps to the site', () => {
    expect(landingViewBox({ altitudeKm: 5000, target: JEZERO }, SCREEN, 0.41)).toBeNull()
    expect(landingViewBox({ altitudeKm: 46_000, target: JEZERO }, SCREEN, 0.41)).toBeNull()
    const widest = landingViewBox({ altitudeKm: 1000, target: JEZERO }, SCREEN, 0.41)
    if (widest) expect((widest.bounds.north - widest.bounds.south) * KM_PER_DEG).toBeLessThanOrEqual(LANDING_VIEW_MAX_KM + 1e-6)
  })

  it('stops at 0 and 360°E and at 85° of latitude, where the lattice does', () => {
    const atZero = landingViewBox({ altitudeKm: 300, target: { latitude: 0, longitudeEast: 0.5 } }, SCREEN, 0.41)!
    expect(atZero.bounds.west).toBe(0)
    expect(atZero.bounds.east).toBeGreaterThan(0.5)
    const atEnd = landingViewBox({ altitudeKm: 300, target: { latitude: 0, longitudeEast: 359.5 } }, SCREEN, 0.41)!
    expect(atEnd.bounds.east).toBe(360)
    const north = landingViewBox({ altitudeKm: 300, target: { latitude: 84, longitudeEast: 100 } }, SCREEN, 0.41)!
    expect(north.bounds.north).toBe(85)
    expect(landingLattice(north.bounds, north.spacingKm)).not.toBeNull()
    expect(landingViewBox({ altitudeKm: 300, target: { latitude: 89, longitudeEast: 100 } }, SCREEN, 0.41)).toBeNull()
  })

  it('gives no box for a view that is not one', () => {
    expect(landingViewBox({ altitudeKm: 0, target: JEZERO }, SCREEN, 0.41)).toBeNull()
    expect(landingViewBox({ altitudeKm: 300, target: { latitude: Number.NaN, longitudeEast: 77 } }, SCREEN, 0.41)).toBeNull()
    expect(landingViewBox({ altitudeKm: 300, target: JEZERO }, { fovDeg: 25, aspect: 0 }, 0.41)).toBeNull()
    expect(landingViewBox({ altitudeKm: 300, target: JEZERO }, SCREEN, 0)).toBeNull()
  })
})
