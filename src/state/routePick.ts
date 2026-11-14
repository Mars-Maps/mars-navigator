import { create } from 'zustand'
import type { MarsCoordinate, SurfacePoint } from '../domain'
import { useMissionStore } from './missionStore'

/**
 * Pick on the globe: which route field the next left click on the
 * globe fills. Its own store, like the Measure tool's, so missionStore stays
 * under the 500-line limit. A stop is its index in the draft; `new-stop`
 * adds one before the destination.
 */
export type RoutePickSlot = 'departure' | 'destination' | 'new-stop' | number

export interface RoutePickState {
  /** The field being picked, or null when no pick is running. */
  slot: RoutePickSlot | null
  startRoutePick: (slot: RoutePickSlot) => void
  cancelRoutePick: () => void
  /** The pick's click: writes the field, selects the point as Set point does, and ends the pick. */
  pickRoutePoint: (point: MarsCoordinate) => void
}

/** What the notice says while `slot` is being picked. */
export function describeRoutePick(slot: RoutePickSlot): string {
  if (slot === 'departure') return 'Click the surface to set the departure'
  if (slot === 'destination') return 'Click the surface to set the destination'
  if (slot === 'new-stop') return 'Click the surface to add a stop'
  return `Click the surface to set stop ${slot + 1}`
}

/**
 * The description of the marked point at exactly `coordinate`, for the
 * field's label: a field filled from a marker shows its name until its
 * value changes. null for no value, no marker there, or an unnamed one.
 */
export function markerLabelAt(markers: readonly SurfacePoint[], coordinate: MarsCoordinate | null): string | null {
  if (!coordinate) return null
  const m = markers.find(
    (p) => p.coordinate.latitude === coordinate.latitude && p.coordinate.longitudeEast === coordinate.longitudeEast,
  )
  return m?.label ?? null
}

/** Writes `point` into the route draft's `slot`, through the store's own setters. */
export function writeRouteSlot(slot: RoutePickSlot, point: MarsCoordinate): void {
  const mission = useMissionStore.getState()
  if (slot === 'departure') mission.setDeparture(point)
  else if (slot === 'destination') mission.setDestination(point)
  else if (slot === 'new-stop') mission.addStop(point)
  else if (slot < mission.routeDraft.stops.length) mission.updateStop(slot, point)
}

export const useRoutePick = create<RoutePickState>()((set, get) => ({
  slot: null,
  startRoutePick: (slot) => set({ slot }),
  // Leaves an idle store alone, so cancelling with no pick renders nothing.
  cancelRoutePick: () => set((s) => (s.slot === null ? s : { slot: null })),
  pickRoutePoint: (point) => {
    const { slot } = get()
    if (slot === null) return
    set({ slot: null })
    // The draft is read-only while navigating, as Set point leaves it.
    if (useMissionStore.getState().viewMode === 'navigation') return
    writeRouteSlot(slot, point)
    useMissionStore.getState().selectPoint(point)
  },
}))

/**
 * Whether a running pick of stop `slot` no longer points at the stop it
 * started on: stops were added or removed (a ×, Clear, a
 * route end taken out), or the stop moved to another place in the list
 * (a drag). A new value typed into that same stop keeps the pick, since it
 * is still that stop. An empty stop (null) is told apart only by where the
 * other values went, so typing into it while another stop is also empty
 * cancels the pick too: the safe way to be wrong, as the next click is then
 * a plain click. Pure, for the subscription below and its tests.
 */
export function stopPickShifted(
  slot: number,
  before: readonly (MarsCoordinate | null)[],
  after: readonly (MarsCoordinate | null)[],
): boolean {
  if (before === after) return false
  if (before.length !== after.length) return true
  const picked = before[slot]
  return picked !== undefined && after[slot] !== picked && after.includes(picked)
}

// A stop's pick is held by its index, so a change that shifts the stops
// would send the click to another stop. Cancel it then, as
// Escape does; the departure, destination and new-stop picks are unaffected.
// Module-level: the store lives as long as the app.
useMissionStore.subscribe((s, prev) => {
  const { slot } = useRoutePick.getState()
  if (typeof slot !== 'number') return
  if (stopPickShifted(slot, prev.routeDraft.stops, s.routeDraft.stops)) useRoutePick.getState().cancelRoutePick()
})
