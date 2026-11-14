import { create } from 'zustand'
import { clampStopIndex } from './walkPlan'

/**
 * The route waypoint the walker is heading for while standing on a
 * followed route: the HUD aims at it and the stop card describes
 * it, as they do for a walk plan's stop (`useWalkPlan`). The HUD's buttons
 * move it; a route first stood on starts at the waypoint after departure,
 * and the aim survives leaving and standing on the same route again. "The
 * same route" is the same user waypoints (`waypointsKey`), not the
 * option's id, which is `option-<strategy>` for every request: a new request
 * starts over, and another strategy for the same request keeps the aim.
 * Its own store, as missionStore is at its 500-line limit.
 */
export interface RouteFollowState {
  /** The key of the waypoints the aim belongs to (`waypointsKey`); null before any. */
  routeId: string | null
  /** Index into the followed route's user waypoints (`routeWaypoints`), not its `points`. */
  aimedIndex: number
  /** Stands on the waypoints keyed `id`, `count` of them: new waypoints start at `FIRST_AIMED_INDEX`, the same keep their aim, clamped. */
  followRoute: (id: string, count: number) => void
  /** Aims at `index`, kept within a route of `count` points. */
  aimAt: (index: number, count: number) => void
}

/** Where a route is first aimed: the waypoint after departure, or departure alone on a route of one point. */
export const FIRST_AIMED_INDEX = 1

export const useRouteFollow = create<RouteFollowState>()((set, get) => ({
  routeId: null,
  aimedIndex: FIRST_AIMED_INDEX,
  followRoute: (id, count) => {
    const { routeId, aimedIndex } = get()
    const next = clampStopIndex(routeId === id ? aimedIndex : FIRST_AIMED_INDEX, count)
    if (routeId !== id || next !== aimedIndex) set({ routeId: id, aimedIndex: next })
  },
  aimAt: (index, count) => {
    const next = clampStopIndex(index, count)
    if (next !== get().aimedIndex) set({ aimedIndex: next })
  },
}))
