import { describe, expect, it } from 'vitest'
import type { MarsCoordinate } from '../../src/domain'
import { makeFrame, toCoordinate, toPatch } from '../../src/features/mars-3d/surfaceView/surfacePatch'
import { northOnPatch, screenHeadingDeg, walkerHeading } from '../../src/features/mars-3d/surfaceView/walkerHeading'
import { pointerAngle } from '../../src/features/mission-ui/hud/wayPointerMath'
import { distanceAndBearing } from '../../src/features/route-analysis/distanceAndBearing'

/**
 * The pointer's two inputs come from different features: the walker's
 * heading from the ground patch and the bearing from route analysis.
 * This checks the conventions meet: a point the walker faces is
 * straight ahead, one on their left is 90° left, in both hemispheres and
 * across 0°/360°.
 */

const DEG = Math.PI / 180

/** Where the walker stands on the patch: km east and north of its centre. */
const WALKER = { xKm: 6, yKm: 4 }

/** The arrow's angle for the walker at WALKER, turned `yawDeg` from the patch's +y, aiming at `target`. */
function arrowAngle(centre: MarsCoordinate, yawDeg: number, target: MarsCoordinate): number {
  const frame = makeFrame(centre)
  const here = toCoordinate(frame, WALKER.xKm, WALKER.yKm)
  const north = northOnPatch(frame, here)
  if (north === null) throw new Error('fixture is too close to a pole')
  const heading = walkerHeading(screenHeadingDeg(north, yawDeg * DEG))
  const angle = pointerAngle(heading, distanceAndBearing(here, target).initialBearingDeg)
  if (angle.classification !== 'DERIVED') throw new Error(`expected an angle, got ${angle.classification}`)
  return angle.value
}

/** The yaw, degrees from the patch's +y, that faces `target` from WALKER. */
function yawTowards(centre: MarsCoordinate, target: MarsCoordinate): number {
  const p = toPatch(makeFrame(centre), target)
  return Math.atan2(p.xKm - WALKER.xKm, p.yKm - WALKER.yKm) / DEG
}

/** a − b, wrapped into (−180, 180]. */
const offBy = (a: number, b: number) => ((((a - b) % 360) + 540) % 360) - 180

/** The heading is shown to the whole degree, so the arrow can be half a degree out, plus a little projection. */
const TOLERANCE_DEG = 1

const CENTRES: [string, MarsCoordinate][] = [
  ['northern mid-latitude', { latitude: 40, longitudeEast: 120 }],
  ['southern mid-latitude', { latitude: -40, longitudeEast: 120 }],
  ['across 0°/360°', { latitude: 5, longitudeEast: 359.95 }],
  ['high north', { latitude: 75, longitudeEast: 10 }],
  ['high south', { latitude: -75, longitudeEast: 200 }],
]

describe('the way pointer with the walker heading and the route bearing', () => {
  it.each(CENTRES)('%s: a point the walker faces is straight ahead', (_, centre) => {
    const target = toCoordinate(makeFrame(centre), -5, 16)
    const yaw = yawTowards(centre, target)
    expect(Math.abs(offBy(arrowAngle(centre, yaw, target), 0))).toBeLessThan(TOLERANCE_DEG)
  })

  it.each(CENTRES)('%s: turned 90° right of a point, the arrow is 90° left', (_, centre) => {
    const target = toCoordinate(makeFrame(centre), -12, -9)
    const yaw = yawTowards(centre, target) + 90
    expect(Math.abs(offBy(arrowAngle(centre, yaw, target), 270))).toBeLessThan(TOLERANCE_DEG)
  })
})
