import { describe, expect, it } from 'vitest'
import { MARS_MEAN_RADIUS_KM, unavailable, type SurfacePoint } from '../../src/domain'
import { NEAR_MARKER_PX, nearbyMarker } from '../../src/features/mission-ui/nearbyMarker'

const marker = (id: string, latitude: number, longitudeEast: number, label?: string): SurfacePoint => ({
  id,
  coordinate: { latitude, longitudeEast },
  elevationMeters: unavailable('fixture'),
  ...(label ? { label } : {}),
})

/** One degree of arc on the mean-radius sphere, km. */
const DEG_KM = (Math.PI / 180) * MARS_MEAN_RADIUS_KM

describe('nearbyMarker', () => {
  // 1 km per pixel: the tolerance is NEAR_MARKER_PX km on the ground.
  const kmPerPx = 1
  const gale = marker('m1', -4.5, 137.4, 'Gale')

  it('finds a marker within the tolerance of the pick', () => {
    // 0.2° of latitude is about 11.8 km, inside 28 km.
    expect(nearbyMarker([gale], { latitude: -4.3, longitudeEast: 137.4 }, kmPerPx)).toBe(gale)
  })

  it('finds nothing when every marker is further than the tolerance', () => {
    // 1° is about 59 km, outside 28 km.
    expect(nearbyMarker([gale], { latitude: -3.5, longitudeEast: 137.4 }, kmPerPx)).toBeNull()
    expect(nearbyMarker([], { latitude: -4.5, longitudeEast: 137.4 }, kmPerPx)).toBeNull()
  })

  it('scales the tolerance with the kilometres per pixel', () => {
    const pick = { latitude: -3.5, longitudeEast: 137.4 }
    // Zoomed out, 1° is within 28 px; zoomed in, it is not.
    expect(nearbyMarker([gale], pick, DEG_KM / 10)).toBe(gale)
    expect(nearbyMarker([gale], pick, DEG_KM / 100)).toBeNull()
  })

  it('names the closest of several nearby markers', () => {
    const near = marker('m2', -4.4, 137.4)
    const nearer = marker('m3', -4.45, 137.4)
    expect(nearbyMarker([gale, near, nearer], { latitude: -4.46, longitudeEast: 137.4 }, kmPerPx)).toBe(nearer)
  })

  it('treats 0°E and 360°E as the same meridian', () => {
    const atZero = marker('m4', 10, 0)
    expect(nearbyMarker([atZero], { latitude: 10, longitudeEast: 359.9 }, kmPerPx)).toBe(atZero)
  })

  it('is null without a scale: the camera has not settled, or the figure is not positive', () => {
    const pick = { latitude: -4.5, longitudeEast: 137.4 }
    expect(nearbyMarker([gale], pick, null)).toBeNull()
    expect(nearbyMarker([gale], pick, 0)).toBeNull()
    expect(nearbyMarker([gale], pick, Number.NaN)).toBeNull()
  })

  it('respects a custom tolerance, and zero means only the exact point', () => {
    const pick = { latitude: -4.3, longitudeEast: 137.4 }
    expect(nearbyMarker([gale], pick, kmPerPx, 5)).toBeNull()
    expect(nearbyMarker([gale], gale.coordinate, kmPerPx, 0)).toBe(gale)
    expect(NEAR_MARKER_PX).toBeGreaterThan(0)
  })
})
