import { describe, expect, it } from 'vitest'
import { Group, Mesh, PerspectiveCamera, Vector3 } from 'three'
import {
  HEADING_POLE_MARGIN_DEG,
  northHeading,
} from '../../src/features/mars-3d/cameraMath'

const DEG = Math.PI / 180
const TILT = 25.19 * DEG

// Camera on +z looking at the globe centre, screen-up +y, screen-right +x.
const VIEW = new Vector3(0, 0, 1)
const UP = new Vector3(0, 1, 0)
const RIGHT = new Vector3(1, 0, 0)

function value(h: ReturnType<typeof northHeading>): number {
  if (h.classification !== 'DERIVED') throw new Error(`expected DERIVED, got ${h.classification}`)
  return h.value
}

describe('northHeading', () => {
  it('reads 0° when north is straight up', () => {
    const h = northHeading(VIEW, new Vector3(0, 1, 0), UP, RIGHT)
    expect(h.classification).toBe('DERIVED')
    expect(value(h)).toBeCloseTo(0, 9)
  })

  it('reads the tilt left of up for the globe group rotated about +z', () => {
    // MarsGlobe rotates its group by +tilt about z, which leans north left.
    const north = new Vector3(0, 1, 0).applyAxisAngle(new Vector3(0, 0, 1), TILT)
    expect(value(northHeading(VIEW, north, UP, RIGHT))).toBeCloseTo(360 - 25.19, 6)
  })

  it('reads the tilt right of up when north leans right', () => {
    const north = new Vector3(Math.sin(TILT), Math.cos(TILT), 0)
    expect(value(northHeading(VIEW, north, UP, RIGHT))).toBeCloseTo(25.19, 6)
  })

  it('reads 180° when north is down and 90° when it is right', () => {
    expect(value(northHeading(VIEW, new Vector3(0, -1, 0), UP, RIGHT))).toBeCloseTo(180, 9)
    expect(value(northHeading(VIEW, new Vector3(1, 0, 0), UP, RIGHT))).toBeCloseTo(90, 9)
  })

  it('ignores the part of the axis along the view, so a view centre off the equator still reads 0°', () => {
    // View centre at 60° N on the central meridian; north is still screen-up.
    const view = new Vector3(0, Math.sin(60 * DEG), Math.cos(60 * DEG))
    const up = new Vector3(0, Math.cos(60 * DEG), -Math.sin(60 * DEG))
    expect(value(northHeading(view, new Vector3(0, 1, 0), up, RIGHT))).toBeCloseTo(0, 9)
  })

  it('does not depend on the vectors being unit length', () => {
    const north = new Vector3(Math.sin(TILT), Math.cos(TILT), 0)
    const a = value(northHeading(VIEW, north, UP, RIGHT))
    const b = value(northHeading(VIEW.clone().multiplyScalar(3.39), north.clone().multiplyScalar(7), UP, RIGHT))
    expect(b).toBeCloseTo(a, 9)
  })

  describe('wrap-around', () => {
    it('keeps a heading just left of up below 360', () => {
      const north = new Vector3(-1e-6, 1, 0)
      const h = value(northHeading(VIEW, north, UP, RIGHT))
      expect(h).toBeLessThan(360)
      expect(h).toBeGreaterThan(359.99)
    })

    it('keeps a heading just right of up above 0', () => {
      const h = value(northHeading(VIEW, new Vector3(1e-6, 1, 0), UP, RIGHT))
      expect(h).toBeGreaterThan(0)
      expect(h).toBeLessThan(0.01)
    })

    it('never returns -0 or 360', () => {
      const h = value(northHeading(VIEW, new Vector3(-0, 1, 0), UP, RIGHT))
      expect(Object.is(h, 0)).toBe(true)
      const tiny = value(northHeading(VIEW, new Vector3(-1e-300, 1, 0), UP, RIGHT))
      expect(tiny).toBeGreaterThanOrEqual(0)
      expect(tiny).toBeLessThan(360)
    })
  })

  describe('UNAVAILABLE', () => {
    it('at the north pole, naming it', () => {
      const h = northHeading(new Vector3(0, 1, 0), new Vector3(0, 1, 0), new Vector3(0, 0, -1), RIGHT)
      expect(h.classification).toBe('UNAVAILABLE')
      if (h.classification === 'UNAVAILABLE') expect(h.reason).toContain('north pole')
    })

    it('at the south pole, naming it', () => {
      const h = northHeading(new Vector3(0, -1, 0), new Vector3(0, 1, 0), new Vector3(0, 0, 1), RIGHT)
      expect(h.classification).toBe('UNAVAILABLE')
      if (h.classification === 'UNAVAILABLE') expect(h.reason).toContain('south pole')
    })

    it('inside the margin but not outside it', () => {
      const at = (deg: number) =>
        northHeading(
          new Vector3(0, Math.cos(deg * DEG), Math.sin(deg * DEG)),
          new Vector3(0, 1, 0),
          new Vector3(0, Math.sin(deg * DEG), -Math.cos(deg * DEG)),
          RIGHT,
        ).classification
      expect(at(HEADING_POLE_MARGIN_DEG * 0.5)).toBe('UNAVAILABLE')
      expect(at(HEADING_POLE_MARGIN_DEG * 2)).toBe('DERIVED')
    })

    it('for a zero or non-finite input, with a different reason from the pole', () => {
      const zero = northHeading(new Vector3(), new Vector3(0, 1, 0), UP, RIGHT)
      const nan = northHeading(VIEW, new Vector3(NaN, 1, 0), UP, RIGHT)
      const inf = northHeading(VIEW, new Vector3(0, 1, 0), new Vector3(0, Infinity, 0), RIGHT)
      const noScreen = northHeading(VIEW, new Vector3(0, 1, 0), new Vector3(), new Vector3())
      for (const h of [zero, nan, inf, noScreen]) {
        expect(h.classification).toBe('UNAVAILABLE')
        if (h.classification === 'UNAVAILABLE') {
          expect(h.reason).toContain('could not be computed')
          expect(h.reason).not.toContain('pole')
        }
      }
    })
  })

  it('states its method when DERIVED', () => {
    const h = northHeading(VIEW, new Vector3(0, 1, 0), UP, RIGHT)
    if (h.classification !== 'DERIVED') throw new Error('expected DERIVED')
    expect(h.method).toMatch(/clockwise from screen-up/)
  })
})

describe('northHeading with the scene transforms', () => {
  // As CameraController reads them: north is the mesh's local +y, the screen
  // axes are the camera's matrix columns, and the view direction is the
  // camera position from the globe centre.
  function sceneHeading(spinRad: number, cameraAt: Vector3) {
    const group = new Group()
    group.rotation.z = TILT // MarsGlobe's tilt group
    const mesh = new Mesh()
    mesh.rotation.y = spinRad // the demo spin
    group.add(mesh)
    group.updateMatrixWorld(true)
    const camera = new PerspectiveCamera()
    camera.position.copy(cameraAt)
    camera.lookAt(0, 0, 0)
    camera.updateMatrixWorld(true)
    return northHeading(
      cameraAt.clone().normalize(),
      new Vector3(0, 1, 0).transformDirection(mesh.matrixWorld),
      new Vector3().setFromMatrixColumn(camera.matrixWorld, 1),
      new Vector3().setFromMatrixColumn(camera.matrixWorld, 0),
    )
  }

  it('reads the tilt left of up from the start camera, whatever the spin', () => {
    for (const spin of [0, 1, 2.5, -4]) {
      expect(value(sceneHeading(spin, new Vector3(0, 0, 10)))).toBeCloseTo(360 - 25.19, 6)
    }
  })

  it('reads about 0° once the globe is north-up', () => {
    const group = new Group()
    const mesh = new Mesh()
    group.add(mesh)
    group.updateMatrixWorld(true)
    const camera = new PerspectiveCamera()
    camera.position.set(0, 0, 10)
    camera.lookAt(0, 0, 0)
    camera.updateMatrixWorld(true)
    const h = northHeading(
      new Vector3(0, 0, 1),
      new Vector3(0, 1, 0).transformDirection(mesh.matrixWorld),
      new Vector3().setFromMatrixColumn(camera.matrixWorld, 1),
      new Vector3().setFromMatrixColumn(camera.matrixWorld, 0),
    )
    expect(value(h)).toBeCloseTo(0, 9)
  })
})
