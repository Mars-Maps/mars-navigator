import { create } from 'zustand'
import type { MarsCoordinate } from '../domain'

/** A point along the active route: where it is, and how far from the departure. */
export interface HoveredRoutePoint {
  coordinate: MarsCoordinate
  distanceKm: number
}

/**
 * The route point under the navigation elevation chart's pointer, so
 * the globe can mark the same place on the route line. Its own store,
 * like the walker's heading: it changes as the pointer moves, so only its
 * readers re-render. Written by the navigation panel's chart alone (the
 * Terrain Profile tool has no route), and cleared when the pointer leaves or
 * the chart unmounts, which ending navigation does.
 */
export interface RouteHoverState {
  hoveredRoutePoint: HoveredRoutePoint | null
  setHoveredRoutePoint: (point: HoveredRoutePoint | null) => void
}

export const useRouteHover = create<RouteHoverState>()((set) => ({
  hoveredRoutePoint: null,
  setHoveredRoutePoint: (point) => set({ hoveredRoutePoint: point }),
}))
