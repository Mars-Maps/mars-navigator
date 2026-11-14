import { describe, expect, it } from 'vitest'
import { Vector3 } from 'three'
import {
  coordinateToLocalPoint,
  localPointToCoordinate,
} from '../../src/features/mars-3d/projection'

const R = 3.3895

const at = (latitude: number, longitudeEast: number) => ({ latitude, longitudeEast })

describe('projection: mesh-local space ↔ MarsCoordinate', () => {
  // The texture's left edge (180°W = 180°E) faces −X; its centre (0°) faces
  // +X; longitude increases counter-clockwise seen from +Y. These pin the
  // convention so a texture or grid cannot silently mirror.
  it.each([
    ['−X', [-R, 0, 0], 0, 180],
    ['+X', [R, 0, 0], 0, 0],
    ['+Z (90°W)', [0, 0, R], 0, 270],
    ['−Z (90°E)', [0, 0, -R], 0, 90],
  ] as const)('%s on the equator', (_, p, lat, lon) => {
    const c = localPointToCoordinate(new Vector3(...p), R)
    expect(c.latitude).toBeCloseTo(lat, 9)
    expect(c.longitudeEast).toBeCloseTo(lon, 9)
  })

  it('maps the poles to ±90° latitude', () => {
    expect(localPointToCoordinate(new Vector3(0, R, 0), R).latitude).toBeCloseTo(90, 9)
    expect(localPointToCoordinate(new Vector3(0, -R, 0), R).latitude).toBeCloseTo(-90, 9)
  })

  it('clamps a point slightly off the sphere instead of returning NaN', () => {
    const c = localPointToCoordinate(new Vector3(0, R * 1.0001, 0), R)
    expect(c.latitude).toBe(90)
  })

  it('always returns longitude in [0, 360)', () => {
    const c = localPointToCoordinate(new Vector3(-R, 0, -1e-12), R)
    expect(c.longitudeEast).toBeGreaterThanOrEqual(0)
    expect(c.longitudeEast).toBeLessThan(360)
  })

  it.each([
    [0, 0],
    [0, 90],
    [0, 180],
    [0, 270],
    [0, 359.9],
    [0, 180.0001],
    [45, 137.4],
    [-4.5, 137.4],
    [89.9, 10],
    [-89.9, 350],
  ])('round-trips (%s, %s) through a point and back', (lat, lon) => {
    const back = localPointToCoordinate(coordinateToLocalPoint(at(lat, lon), R), R)
    expect(back.latitude).toBeCloseTo(lat, 9)
    expect(back.longitudeEast).toBeCloseTo(lon, 9)
  })

  it('places points at the requested radius and reuses the target vector', () => {
    const target = new Vector3()
    const p = coordinateToLocalPoint(at(30, 200), R * 1.01, target)
    expect(p).toBe(target)
    expect(p.length()).toBeCloseTo(R * 1.01, 9)
  })
})
