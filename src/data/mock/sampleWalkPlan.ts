import {
  MARS_MEAN_RADIUS_KM,
  simulated,
  SUITED_SLOPE_LIMIT,
  unavailable,
  type MarsCoordinate,
  type WalkLeg,
  type WalkPlan,
  type WalkStop,
} from '../../domain'

/**
 * SIMULATED DATA — NOT A PLAN.
 *
 * A hand-made walk in Jezero crater so the views that read the walk
 * plan (the surface walk, the HUD, the stop card) can be seen
 * working together in the app before the planner exists. Loaded
 * only on request (`?sampleWalk`), and labelled SIMULATED on screen while it
 * is shown.
 *
 * Nothing here is a finding: the stops are three points picked by hand on
 * the crater floor, deliberately not any mission's landing point or
 * waypoint, the legs straight lines between them. No geologic map was
 * read, so every stop's unit is UNAVAILABLE and the goal names no real unit;
 * no slope was measured and no hazard scanned, so those are UNAVAILABLE too.
 * The distances are the straight lines' lengths, so as invented as the lines.
 *
 * In the domain's shape, not a raw one behind an adapter like
 * simulatedTraverse.ts: it stands in for the planner's output,
 * which is a domain object, not for an external dataset.
 */

const SOURCE = 'Sample walk plan, invented to test the walk flow; not a plan'
const NO_MAP = 'Sample walk plan: no geologic map was read for these points'

const POINTS: readonly MarsCoordinate[] = [
  { latitude: 18.43, longitudeEast: 77.47 },
  { latitude: 18.4328, longitudeEast: 77.4654 },
  { latitude: 18.4363, longitudeEast: 77.4597 },
]

const stops: WalkStop[] = POINTS.map((coordinate, i) => ({
  id: `sample-${i + 1}`,
  // Start, then Stop 1, 2 … as the planner names them.
  label: i === 0 ? 'Start · sample' : `Stop ${i} · sample`,
  coordinate,
  unit: unavailable(NO_MAP),
  reason: simulated('A point picked by hand to test the walk flow', SOURCE),
}))

const legs: WalkLeg[] = stops.slice(1).map((to, i) => {
  const from = stops[i]
  return {
    fromStopId: from.id,
    toStopId: to.id,
    path: simulated([from.coordinate, to.coordinate], SOURCE),
    distanceKm: simulated(greatCircleKm(from.coordinate, to.coordinate), `${SOURCE}: the straight line's length`),
    steepestSlopeDeg: unavailable('Sample walk plan: no slope was measured'),
    hazards: unavailable('Sample walk plan: no hazards were scanned'),
  }
})

export const SAMPLE_WALK_PLAN: WalkPlan = {
  goal: {
    id: 'sample-goal',
    label: 'Sample walk (simulated)',
    unitNames: ['Sample unit, not from any map'],
    reason: simulated('No science goal: this walk only tests the flow', SOURCE),
  },
  stops,
  legs,
  slopeLimit: SUITED_SLOPE_LIMIT,
}

/** Great-circle distance on the mean sphere, km. */
function greatCircleKm(a: MarsCoordinate, b: MarsCoordinate): number {
  const rad = Math.PI / 180
  const dLat = (b.latitude - a.latitude) * rad
  const dLon = (b.longitudeEast - a.longitudeEast) * rad
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.latitude * rad) * Math.cos(b.latitude * rad) * Math.sin(dLon / 2) ** 2
  return 2 * MARS_MEAN_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)))
}
