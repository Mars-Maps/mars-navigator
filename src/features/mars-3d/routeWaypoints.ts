import type { MarsCoordinate } from '../../domain'

/**
 * The route draft's waypoints, without geometry. Split from routeGeometry
 * so the shell's caption can ask "is a line drawn?" without pulling
 * Three.js into the first chunk; routeGeometry re-exports all of it.
 */

export type OverlayPointKind = 'departure' | 'stop' | 'destination' | 'marked' | 'measure' | 'terrain'

export interface OverlayPoint {
  kind: OverlayPointKind
  coordinate: MarsCoordinate
}

/** The route request as the search bar builds it; ends may be unchosen. */
export interface WaypointDraft {
  departure: MarsCoordinate | null
  /** `null` is a stop the user entered but that is not valid: no pin. */
  stops: readonly (MarsCoordinate | null)[]
  destination: MarsCoordinate | null
}

/** The draft's chosen waypoints in travel order: departure, stops, destination. */
export function draftWaypoints(draft: WaypointDraft): OverlayPoint[] {
  const out: OverlayPoint[] = []
  if (draft.departure) out.push({ kind: 'departure', coordinate: draft.departure })
  for (const stop of draft.stops) if (stop) out.push({ kind: 'stop', coordinate: stop })
  if (draft.destination) out.push({ kind: 'destination', coordinate: draft.destination })
  return out
}

/** True when the draft has at least two chosen waypoints, so a line is drawn. */
export function hasRouteLine(draft: WaypointDraft): boolean {
  const ends = (draft.departure ? 1 : 0) + (draft.destination ? 1 : 0)
  return ends + draft.stops.filter((s) => s !== null).length >= 2
}
