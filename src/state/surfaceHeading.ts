import { create } from 'zustand'
import { isAvailable, type Classified, type MarsCoordinate } from '../domain'

/**
 * Where the walker stands and faces on the surface. Its own
 * store, separate from missionStore, like the mission clock: it changes as
 * the walker moves, so only what shows them re-renders. Written by the ground
 * view: the heading when the whole degree changes, at most every 50 ms; the
 * position with the coordinate readout, about four times a second, and only
 * when it has changed. Both null while nobody is standing on the surface.
 */
export interface SurfaceHeadingState {
  heading: Classified<number> | null
  setHeading: (heading: Classified<number> | null) => void
  /** The walker's coordinate, for the HUD and the sun. */
  position: Classified<MarsCoordinate> | null
  setPosition: (position: Classified<MarsCoordinate>) => void
  /** Nobody stands here any more. */
  clear: () => void
}

function samePlace(a: Classified<MarsCoordinate> | null, b: Classified<MarsCoordinate>): boolean {
  if (a === null || a.classification !== b.classification) return false
  if (!isAvailable(a) || !isAvailable(b)) return false
  return a.value.latitude === b.value.latitude && a.value.longitudeEast === b.value.longitudeEast
}

export const useSurfaceHeading = create<SurfaceHeadingState>()((set) => ({
  heading: null,
  setHeading: (heading) => set({ heading }),
  position: null,
  // A walker standing still re-renders nothing.
  setPosition: (position) => set((s) => (samePlace(s.position, position) ? s : { position })),
  clear: () => set({ heading: null, position: null }),
}))
