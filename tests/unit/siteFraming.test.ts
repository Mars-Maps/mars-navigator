import { describe, expect, it } from 'vitest'
import { JEZERO } from '../../src/data/sites/sites'
import { facesCamera } from '../../src/features/mars-3d/cameraMath'
import { altitudeToFrame, altitudeToFrameBounds, FRAME_FILL } from '../../src/features/mars-3d/framing'
import { FRAME_MIN_ALTITUDE_KM, MAX_CAMERA_ALTITUDE_KM, MIN_CAMERA_ALTITUDE_KM } from '../../src/features/mars-3d/constants'
import { spinToFace, coordinateToLocalPoint } from '../../src/features/mars-3d/projection'
import { Vector3 } from 'three'
import { useMissionStore, useSite } from '../../src/state'

describe('altitudeToFrame', () => {
  it('fits the span into the view: the half-chord fills FRAME_FILL of the half-view', () => {
    // A 10° span on a 1000 km sphere with a 90° lens and no limits.
    const altitude = altitudeToFrame(10, 90, 1000, { min: 0, max: Infinity })
    const half = (5 * Math.PI) / 180
    const halfChord = 1000 * Math.sin(half)
    const depth = 1000 * (1 - Math.cos(half))
    expect(halfChord / (altitude + depth)).toBeCloseTo(FRAME_FILL * Math.tan(Math.PI / 4), 9)
  })

  it('grows with the span and stays inside the camera limits', () => {
    expect(altitudeToFrame(2, 25, 3389.5, { min: 0, max: Infinity })).toBeGreaterThan(
      altitudeToFrame(1, 25, 3389.5, { min: 0, max: Infinity }),
    )
    expect(altitudeToFrame(0.01)).toBe(FRAME_MIN_ALTITUDE_KM)
    // Half the planet needs about 18,500 km with this lens, under the ceiling; a tighter one clamps.
    expect(altitudeToFrame(179)).toBeLessThan(MAX_CAMERA_ALTITUDE_KM)
    expect(altitudeToFrame(179, 25, 3389.5, { min: 0, max: 100 })).toBe(100)
  })

  it('frames Jezero at the lowest a flight frames a site: its one-degree sheet needs less (the old floor is kept here)', () => {
    expect(altitudeToFrameBounds(JEZERO.bounds)).toBe(FRAME_MIN_ALTITUDE_KM)
    expect(FRAME_MIN_ALTITUDE_KM).toBeGreaterThan(MIN_CAMERA_ALTITUDE_KM)
  })
})

describe('spinToFace', () => {
  it.each([0, 77.43, 180, 270, 359])('turns longitude %s° to face a camera on +z', (lon) => {
    const theta = spinToFace(lon)
    const p = coordinateToLocalPoint({ latitude: 0, longitudeEast: lon }, 1)
    // Rotate about y by theta.
    const x = p.x * Math.cos(theta) + p.z * Math.sin(theta)
    const z = -p.x * Math.sin(theta) + p.z * Math.cos(theta)
    expect(x).toBeCloseTo(0, 9)
    expect(z).toBeCloseTo(1, 9)
  })
})

describe('requestCenter with an altitude', () => {
  it('carries the altitude on the one-shot request, and leaves it off a plain centre', () => {
    const store = useMissionStore.getState()
    const before = useMissionStore.getState().centerRequest?.id ?? 0
    store.requestCenter({ latitude: 1, longitudeEast: 2 }, 500)
    const framed = useMissionStore.getState().centerRequest
    expect(framed).toEqual({ target: { latitude: 1, longitudeEast: 2 }, altitudeKm: 500, id: before + 1 })
    store.requestCenter({ latitude: 3, longitudeEast: 4 })
    const plain = useMissionStore.getState().centerRequest
    expect(plain?.altitudeKm).toBeUndefined()
    expect(plain?.id).toBe(before + 2)
  })
})

describe('goToSite', () => {
  it('in welcome leaves welcome and flies itself; elsewhere it asks for the centre at the frame altitude', () => {
    useMissionStore.setState({ viewMode: 'welcome', centerRequest: null })
    useSite.getState().setSite(JEZERO, 500)
    useSite.getState().goToSite()
    expect(useMissionStore.getState().viewMode).toBe('close-up')
    expect(useMissionStore.getState().centerRequest).toMatchObject({ target: JEZERO.centre, altitudeKm: 500 })
    const first = useMissionStore.getState().centerRequest?.id
    useSite.getState().goToSite()
    expect(useMissionStore.getState().centerRequest?.id).toBe((first ?? 0) + 1)
    useMissionStore.setState({ viewMode: 'navigation' })
    useSite.getState().goToSite()
    expect(useMissionStore.getState().centerRequest?.id).toBe((first ?? 0) + 2)
    expect(useMissionStore.getState().viewMode).toBe('navigation')
    useMissionStore.setState({ viewMode: 'welcome', centerRequest: null })
  })

  it('a plain leave of welcome flies nowhere: only the button does', () => {
    useMissionStore.setState({ viewMode: 'welcome', centerRequest: null })
    useSite.getState().setSite(JEZERO, 500)
    useMissionStore.getState().setViewMode('close-up')
    expect(useMissionStore.getState().viewMode).toBe('close-up')
    expect(useMissionStore.getState().centerRequest).toBeNull()
    useMissionStore.setState({ viewMode: 'welcome' })
  })

  it('does nothing without a site', () => {
    useSite.setState({ site: null, frameAltitudeKm: null })
    useMissionStore.setState({ viewMode: 'welcome', centerRequest: null })
    useSite.getState().goToSite()
    expect(useMissionStore.getState().viewMode).toBe('welcome')
    expect(useMissionStore.getState().centerRequest).toBeNull()
  })
})

describe('facesCamera', () => {
  it('is true for the point under the camera and false for the far side', () => {
    const camera = new Vector3(0, 0, 10)
    const scratch = new Vector3()
    expect(facesCamera(new Vector3(0, 0, 1), camera, scratch)).toBe(true)
    expect(facesCamera(new Vector3(0, 0, -1), camera, scratch)).toBe(false)
    // On the limb, tangent to the line of sight from infinity: a camera at 10 still sees a little past it.
    expect(facesCamera(new Vector3(1, 0, 0), camera, scratch)).toBe(false)
    expect(facesCamera(new Vector3(0.99, 0, 0.14), camera, scratch)).toBe(true)
  })
})
