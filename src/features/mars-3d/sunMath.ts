import { Vector3 } from 'three'
import type { MarsSolarTime } from '../../domain'
import { coordinateToLocalPoint } from './projection'

/**
 * Sun lighting maths. The sun direction is the Mars24 subsolar point
 * (DERIVED, domain/mars24.ts) turned into a unit vector in the globe
 * mesh's local space, so the light can be mounted inside the mesh and the
 * terminator stays attached to the surface through the tilt and the
 * demonstration spin. Pure, so it is testable without WebGL.
 *
 * Brightness: three.js Lambert shading divides irradiance by π, so a sun
 * of intensity π restores the texture's own brightness at the subsolar
 * point. The sun and the night floor add up to π, so the brightest point
 * of the lit globe looks exactly as the unlit globe did, and the night
 * side keeps a quarter of that so a route can still be read there. The
 * split is a rendering choice, not a measurement; the floor stands in
 * for no physical sky light.
 */
export const SUN_INTENSITY = 0.75 * Math.PI
export const NIGHT_INTENSITY = 0.25 * Math.PI
/** Even light from everywhere when the sun position is unavailable: the unlit look. */
export const NEUTRAL_INTENSITY = Math.PI

/** Where the light sits along its direction, scene units. Only the direction matters. */
export const SUN_DISTANCE = 10

/** Unit vector from the globe centre towards the subsolar point, mesh-local. */
export function sunDirection(solar: MarsSolarTime, target: Vector3 = new Vector3()): Vector3 {
  return coordinateToLocalPoint(solar.subsolarPoint, 1, target)
}

/**
 * Sun shading in every globe mode (not only in
 * welcome): the terminator stays in close-up and navigation too, until the
 * right-click menu turns it off for even light. A display choice, stated in
 * the surface caption; the sun position itself is DERIVED either way.
 */
export const SHADING_FADE_SECONDS = 0.6

/** 1 = full sun shading, 0 = even light. */
export function shadingTarget(sunShading: boolean): number {
  return sunShading ? 1 : 0
}

/** Moves `current` towards `target` at a constant rate; reaches it in SHADING_FADE_SECONDS. */
export function stepShading(current: number, target: number, deltaSeconds: number): number {
  const step = deltaSeconds / SHADING_FADE_SECONDS
  return current < target ? Math.min(target, current + step) : Math.max(target, current - step)
}

/** Ambient light for a shading amount: the night floor, blending to the even, unlit look. */
export function ambientIntensity(shading: number): number {
  return NEUTRAL_INTENSITY + (NIGHT_INTENSITY - NEUTRAL_INTENSITY) * shading
}

/** Sun light for a shading amount. */
export function sunIntensity(shading: number): number {
  return SUN_INTENSITY * shading
}
