import { create } from 'zustand'
import { isValidCoordinate, type MarsCoordinate } from '../domain'

/**
 * Where the planned walk lands: the point the user clicks on the map
 * as the first step of Plan a walk. The walk's own start, apart from the
 * route's departure, so setting one never moves the other. Its own store,
 * like the route pick's, so missionStore stays under the 500-line limit.
 */
export interface LandingSiteState {
  landingSite: MarsCoordinate | null
  /** Sets the point; a point that is not a valid coordinate is ignored. */
  setLandingSite: (point: MarsCoordinate) => void
  clearLandingSite: () => void
}

export const useLandingSite = create<LandingSiteState>()((set) => ({
  landingSite: null,
  setLandingSite: (point) => {
    if (isValidCoordinate(point)) set({ landingSite: point })
  },
  // Leaves an empty store alone, so clearing with no site renders nothing.
  clearLandingSite: () => set((s) => (s.landingSite === null ? s : { landingSite: null })),
}))
