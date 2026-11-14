import { useEffect, useMemo } from 'react'
import { BufferAttribute, BufferGeometry, DoubleSide } from 'three'
import type { MarsCoordinate } from '../../../domain'
import { useMissionStore, useWalkPlan } from '../../../state'
import { ROUTE_TRAIL_COLOR, TRAVERSE_COLOR } from '../pinColors'
import type { PlotVertex, RibbonArrays } from '../terrainProfile/routeLine'
import type { GroundPatch } from './groundPatch'
import { drapedSegments } from './drapeLine'
import { dashLines, groundRibbon, joinSegments } from './groundRibbon'
import { routeLine } from './routeLine'

/** Vertices along the line on the ground, metres: fine enough to follow small bumps. */
const STEP_M = 10
/** Above the drawn surface, metres, so the ribbons never flicker into it. */
const LIFT_M = 0.3
/** Dashes on the ground, metres: white and broken, as the planned route is on the globe. */
const DASH_M = 3
const GAP_M = 4
/**
 * Ribbon widths on the ground, metres. The eye is about 1.7 m up
 * with a 70° view: 1.5 m is a clear band underfoot and still some 15 px
 * across at 100 m ahead in a desktop window, where a one-pixel line was
 * lost. The walk is widest because it is what the walker follows; the
 * followed route is a little narrower and the rover's path narrower still,
 * so where they cross, each shows beside the others.
 */
const WALK_WIDTH_M = 1.5
const ROUTE_WIDTH_M = 1.2
const DRIVEN_WIDTH_M = 1
/** A dark fringe this much wider under the walk and the route, so pale dashes read on bright dust. */
const FRINGE_EXTRA_M = 0.5
const FRINGE_COLOR = 0x1f2228
const FRINGE_OPACITY = 0.6
/**
 * The followed route's dashes sit in the middle of the walk's gaps, so
 * where the walk runs along the route the two alternate instead of the
 * white covering the dust.
 */
const ROUTE_PHASE_M = -(DASH_M + (GAP_M - DASH_M) / 2)

/** A ribbon never answers a pick: the ground's right-click menu hits the ground mesh only. */
function noRaycast() {}

/**
 * The planned walk on the surface view's ground: every leg with a
 * path, dropped onto the drawn heights of the patch the walker is on. A leg
 * the planner could not route (UNAVAILABLE) is not drawn, never guessed.
 * The rover's driven path, when passed, goes on the same ground as a
 * solid band in its own colour, so the two never look alike. The route being
 * followed is dashed too, in the colour of its dots on the globe, so
 * it reads as the same route from orbit and on the ground and never as the
 * walk; an option with no path of its own draws nothing (routeLine.ts).
 *
 * All three are flat ribbons about a metre wide lying on the ground,
 * the walk and the route over a dark fringe: a one-pixel line was nearly
 * invisible from eye height. Built when the plan, the route, the traverse
 * or the patch changes, never per frame; each ribbon's geometry is disposed
 * when replaced and on unmount, its JSX-declared material by React Three
 * Fiber.
 */
export function GroundRoute({
  patch,
  traverse,
}: {
  patch: GroundPatch
  /** The rover's driven path up to the slider's sol, or none. */
  traverse?: readonly MarsCoordinate[]
}) {
  const plan = useWalkPlan((s) => s.plan)
  // Set exactly while a route is followed, kept through the surface view.
  const route = useMissionStore((s) => s.activeRoute)
  const followed = useMemo(() => {
    const l = routeLine(route)
    if (l === null || l.classification === 'UNAVAILABLE') return null
    const lines = joinSegments(drapedSegments([l.path], patch.frame, patch.field, STEP_M, LIFT_M))
    return dashedRibbons(lines, patch, ROUTE_WIDTH_M, ROUTE_PHASE_M)
  }, [route, patch])
  const driven = useMemo(() => {
    if (!traverse || traverse.length < 2) return null
    const lines = joinSegments(drapedSegments([traverse], patch.frame, patch.field, STEP_M, LIFT_M))
    return lines.length > 0 ? groundRibbon(lines, patch.field, DRIVEN_WIDTH_M, LIFT_M) : null
  }, [traverse, patch])
  const walk = useMemo(() => {
    if (!plan) return null
    const paths: MarsCoordinate[][] = []
    for (const leg of plan.legs) if (leg.path.classification !== 'UNAVAILABLE') paths.push(leg.path.value)
    const lines = joinSegments(drapedSegments(paths, patch.frame, patch.field, STEP_M, LIFT_M))
    return dashedRibbons(lines, patch, WALK_WIDTH_M, 0)
  }, [plan, patch])
  // Transparent and not writing depth, so they draw in this order over the
  // ground: the rover's path, then the route, then the walk on top.
  return (
    <>
      {driven && <GroundRibbon arrays={driven} color={TRAVERSE_COLOR} order={1} />}
      {followed && <GroundRibbon arrays={followed.fringe} color={FRINGE_COLOR} opacity={FRINGE_OPACITY} order={2} />}
      {followed && <GroundRibbon arrays={followed.line} color={ROUTE_TRAIL_COLOR} order={3} />}
      {walk && <GroundRibbon arrays={walk.fringe} color={FRINGE_COLOR} opacity={FRINGE_OPACITY} order={4} />}
      {walk && <GroundRibbon arrays={walk.line} color={0xffffff} order={5} />}
    </>
  )
}

/** Dashes `widthM` wide and their wider fringe, or null when no dash falls on this patch. */
function dashedRibbons(lines: PlotVertex[][], patch: GroundPatch, widthM: number, phaseM: number) {
  const dashes = dashLines(lines, DASH_M, GAP_M, phaseM)
  if (dashes.length === 0) return null
  return {
    line: groundRibbon(dashes, patch.field, widthM, LIFT_M),
    fringe: groundRibbon(dashes, patch.field, widthM + FRINGE_EXTRA_M, LIFT_M),
  }
}

/** One flat ribbon on the ground, unlit so its colour is exact; its geometry is disposed when replaced or on unmount. */
function GroundRibbon({
  arrays,
  color,
  opacity = 0.9,
  order,
}: {
  arrays: RibbonArrays
  color: number
  opacity?: number
  order: number
}) {
  const geometry = useMemo(() => {
    const g = new BufferGeometry()
    g.setAttribute('position', new BufferAttribute(arrays.positions, 3))
    g.setIndex(new BufferAttribute(arrays.indices, 1))
    return g
  }, [arrays])
  useEffect(() => () => geometry.dispose(), [geometry])
  return (
    <mesh geometry={geometry} raycast={noRaycast} renderOrder={order}>
      <meshBasicMaterial color={color} transparent opacity={opacity} depthWrite={false} side={DoubleSide} />
    </mesh>
  )
}
