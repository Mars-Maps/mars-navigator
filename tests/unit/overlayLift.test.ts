import { Ray, Object3D, Vector3 } from 'three'
import { describe, expect, it } from 'vitest'
import { FRAME_MIN_ALTITUDE_KM, GLOBE_RADIUS, KM_PER_SCENE_UNIT, MIN_CAMERA_ALTITUDE_KM } from '../../src/features/mars-3d/constants'
import {
  OVERLAY_BASE_LIFT,
  overlayLift,
  overlayScale,
  PICK_RADIUS,
  pickCoordinate,
  PICTURE_LIFT,
  ROUTE_LIFT,
} from '../../src/features/mars-3d/overlayLift'
import { coordinateToLocalPoint } from '../../src/features/mars-3d/projection'

const OLD_FLOOR = FRAME_MIN_ALTITUDE_KM / KM_PER_SCENE_UNIT
const FLOOR = MIN_CAMERA_ALTITUDE_KM / KM_PER_SCENE_UNIT
/** Every lift above the grid's, as the overlays declare them. */
const LIFTS = [1.0015, 1.002, 1.0025, 1.003]

describe('overlayLift', () => {
  it('is the nominal lift at and above the old 200 km floor', () => {
    for (const lift of LIFTS) {
      expect(overlayLift(lift, OLD_FLOOR)).toBeCloseTo(lift, 12)
      expect(overlayLift(lift, OLD_FLOOR * 50)).toBeCloseTo(lift, 12)
      expect(overlayScale(lift, OLD_FLOOR * 2)).toBeCloseTo(1, 12)
    }
  })

  it('keeps a tenth of the lift above the grid at the 20 km floor', () => {
    expect(overlayLift(1.002, FLOOR)).toBeCloseTo(OVERLAY_BASE_LIFT + 0.0001, 9)
    expect(overlayLift(1.003, FLOOR)).toBeCloseTo(OVERLAY_BASE_LIFT + 0.0002, 9)
  })

  it('never goes below the grid, even for an altitude of zero or less', () => {
    for (const lift of LIFTS) {
      expect(overlayLift(lift, 0)).toBe(OVERLAY_BASE_LIFT)
      expect(overlayLift(lift, -1)).toBe(OVERLAY_BASE_LIFT)
    }
  })

  it('keeps the overlays in their order, above the picture, at every altitude', () => {
    for (const altitude of [FLOOR, FLOOR * 2, OLD_FLOOR / 2, OLD_FLOOR]) {
      const lifted = LIFTS.map((lift) => overlayLift(lift, altitude))
      for (let i = 1; i < lifted.length; i++) expect(lifted[i]).toBeGreaterThan(lifted[i - 1])
      expect(lifted[0]).toBeGreaterThan(PICTURE_LIFT)
    }
  })

  it('scales geometry built at the nominal lift onto the lift for the altitude', () => {
    const built = GLOBE_RADIUS * 1.002
    expect(built * overlayScale(1.002, FLOOR)).toBeCloseTo(GLOBE_RADIUS * overlayLift(1.002, FLOOR), 12)
  })

  it('puts a pin at the floor within 5% of its distance from the screen centre, where it was over 20%', () => {
    // An overlay h above the picked surface, seen from altitude H above it, is drawn H / (H - h) farther out.
    const shift = (overlay: number, picked: number) => {
      const h = (overlay - picked) * GLOBE_RADIUS
      const H = FLOOR - (picked - 1) * GLOBE_RADIUS
      return H / (H - h) - 1
    }
    expect(shift(ROUTE_LIFT, 1)).toBeGreaterThan(0.2)
    expect(shift(overlayLift(ROUTE_LIFT, FLOOR), PICTURE_LIFT)).toBeLessThan(0.05)
  })
})

describe('pickCoordinate', () => {
  const globe = new Object3D()
  globe.rotation.set(0.3, 1.1, 0)
  globe.updateMatrixWorld(true)

  it('reads the coordinate where the ray meets the picture, not the mean sphere', () => {
    const target = { latitude: 18.4, longitudeEast: 77.5 }
    const onPicture = globe.localToWorld(coordinateToLocalPoint(target, PICK_RADIUS, new Vector3()))
    // A slanted ray, as off the screen centre: from a camera 37 km up over a point 0.5 degrees away.
    const eye = globe.localToWorld(coordinateToLocalPoint({ latitude: 18.9, longitudeEast: 77.5 }, GLOBE_RADIUS + FLOOR, new Vector3()))
    const ray = new Ray(eye, onPicture.clone().sub(eye).normalize())
    const picked = pickCoordinate(ray, globe, new Vector3())
    expect(picked?.latitude).toBeCloseTo(target.latitude, 6)
    expect(picked?.longitudeEast).toBeCloseTo(target.longitudeEast, 6)
  })

  it('is null for a ray that misses the globe', () => {
    const ray = new Ray(new Vector3(0, 0, GLOBE_RADIUS * 3), new Vector3(0, 1, 0))
    expect(pickCoordinate(ray, globe, new Vector3())).toBeNull()
  })
})
