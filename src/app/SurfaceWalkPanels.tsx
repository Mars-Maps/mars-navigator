import { useEffect, useMemo } from 'react'
import { SUITED_SLOPE_LIMIT, unavailable, type Classified, type MarsCoordinate, type RouteOption } from '../domain'
import { routeHudStops } from '../features/mission-ui/hud/hudMath'
import { routeWaypoints, waypointsKey, type RouteWaypoint } from '../features/mission-ui/hud/routeWaypoints'
import { PlannedSurfaceHud, SurfaceHud } from '../features/mission-ui/hud/SurfaceHud'
import { STOP_PHOTO_RADIUS_M } from '../features/mission-ui/photos/photoStripMath'
import { StopCard } from '../features/mission-ui/stops/StopCard'
import { routeStopFacts, stopPlanFacts } from '../features/mission-ui/stops/stopCardMath'
import type { ElevationProfile } from '../features/route-analysis/elevationProfile'
import {
  toRouteRequest,
  useMissionStore,
  useMissionTime,
  useMissionTimeStore,
  useRouteFollow,
  useSurfaceHeading,
  useWalkPlan,
} from '../state'
import { sunElevationAt } from './sunElevation'
import { useElevationAt } from './useElevationAt'
import { useGeologicUnitAt } from './useSelectedGeologicUnit'
import { useSlopeAt } from './useSelectedSlope'
import { useStopPhotos } from './useStopPhotos'

const NO_POSITION = unavailable<MarsCoordinate>('The ground has not reported where the walker stands yet')

/** The active route's elevation profile, read once by the shell for the navigation panel and the route's slopes here. */
interface RouteProfileProps {
  routeProfile: Classified<ElevationProfile> | null
}

/**
 * The HUD while standing on the surface: on the walk plan when
 * there is one; else, standing on a followed route, on the user's
 * waypoints of the route, aimed by `useRouteFollow`; nothing otherwise.
 */
export function WalkHud({ routeProfile }: RouteProfileProps) {
  const hasPlan = useWalkPlan((s) => s.plan !== null)
  const route = useFollowedRoute()
  const waypoints = useRouteWaypoints(route, routeProfile)
  const position: Classified<MarsCoordinate> = useSurfaceHeading((s) => s.position) ?? NO_POSITION
  const utcMs = useMissionTimeStore((s) => s.utcMs)
  const sun = useMemo(() => sunElevationAt(utcMs, position), [utcMs, position])
  if (hasPlan) return <PlannedSurfaceHud position={position} sunElevationDeg={sun} />
  if (route) return <RouteHud waypoints={waypoints} position={position} sunElevationDeg={sun} />
  return null
}

/**
 * The stop being walked to, with the shell's reads of its ground;
 * on a followed route, the aimed waypoint, with its geologic
 * unit read as the point menu reads it. A plan's stop has its unit
 * from the planner, so none is read for it.
 */
export function WalkStopCard({ routeProfile }: RouteProfileProps) {
  const plan = useWalkPlan((s) => s.plan)
  const activeStopIndex = useWalkPlan((s) => s.activeStopIndex)
  const route = useFollowedRoute()
  const waypoints = useRouteWaypoints(route, routeProfile)
  const aimedIndex = useRouteFollow((s) => s.aimedIndex)
  const point = plan ? (plan.stops[activeStopIndex]?.coordinate ?? null) : (waypoints[aimedIndex]?.coordinate ?? null)
  const routeUnit = useGeologicUnitAt(plan ? null : point)
  const facts = plan ? stopPlanFacts(plan, activeStopIndex) : route ? routeStopFacts(waypoints, aimedIndex, routeUnit) : null
  const elevationM = useElevationAt(point)
  const slopeDeg = useSlopeAt(point)
  // The photo strip's radius, so the card and the strip agree on which photos are near a stop.
  const found = useStopPhotos(point, STOP_PHOTO_RADIUS_M)
  if (!facts) return null
  const photos = found.photos === null ? { photos: null, photosUnavailableReason: found.reason } : { photos: found.photos }
  return <StopCard {...facts} elevationM={elevationM} slopeDeg={slopeDeg} {...photos} photoRadiusM={STOP_PHOTO_RADIUS_M} />
}

/** The route the walker stands on: the active route while the surface was entered from navigation; null otherwise. */
function useFollowedRoute(): RouteOption | null {
  return useMissionStore((s) => (s.viewMode === 'surface' && s.surfaceReturn === 'navigation' ? s.activeRoute : null))
}

/**
 * The user's waypoints of the followed route: the search bar's
 * request, the one the route was planned for (the bar is read-only while
 * navigating), says which of the route's points are the user's; a stop it
 * no longer holds is left out, never named from the route. Empty with no route.
 */
function useRouteWaypoints(route: RouteOption | null, profile: Classified<ElevationProfile> | null): RouteWaypoint[] {
  const draft = useMissionStore((s) => s.routeDraft)
  return useMemo(() => (route ? routeWaypoints(route, toRouteRequest(draft), profile) : []), [route, draft, profile])
}

/**
 * The HUD on the route's waypoints: new waypoints start aimed at the one
 * after departure, the same waypoints keep their aim (`waypointsKey`).
 */
function RouteHud({
  waypoints,
  position,
  sunElevationDeg,
}: {
  waypoints: readonly RouteWaypoint[]
  position: Classified<MarsCoordinate>
  sunElevationDeg: Classified<number>
}) {
  const aimedIndex = useRouteFollow((s) => s.aimedIndex)
  const aimAt = useRouteFollow((s) => s.aimAt)
  const followRoute = useRouteFollow((s) => s.followRoute)
  const heading = useSurfaceHeading((s) => s.heading)
  const { solar } = useMissionTime()
  const stops = useMemo(() => routeHudStops(waypoints), [waypoints])
  const count = stops.length
  const key = useMemo(() => waypointsKey(waypoints), [waypoints])
  useEffect(() => followRoute(key, count), [key, count, followRoute])
  if (!heading) return null
  return (
    <SurfaceHud
      heading={heading}
      position={position}
      stops={stops}
      slopeLimit={SUITED_SLOPE_LIMIT}
      activeStopIndex={aimedIndex}
      onGoToStop={(index) => aimAt(index, count)}
      sunElevationDeg={sunElevationDeg}
      solar={solar}
    />
  )
}
