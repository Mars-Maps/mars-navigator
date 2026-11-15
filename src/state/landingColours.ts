import { create } from 'zustand'
import type { SiteBounds } from '../domain'

/**
 * The landing rating as the globe draws it: one code per cell of a
 * lattice over a box, rows north to south, each west to east. The shell
 * rates the ground and sets it while the landing site is being picked; the
 * scene only draws it. Its own store, like the site's ellipse, so
 * missionStore stays under the 500-line limit.
 */
export interface LandingColourGrid {
  bounds: SiteBounds
  cols: number
  rows: number
  /** Per cell: 0 no rating (drawn clear), 1 green, 2 yellow, 3 red. `rows × cols`. */
  rating: Uint8Array
}

export interface LandingColoursState {
  /** null while nothing is to be drawn. */
  grid: LandingColourGrid | null
  /** A grid whose size does not match its codes is refused, and nothing changes. */
  setLandingColours: (grid: LandingColourGrid) => void
  clearLandingColours: () => void
}

export const useLandingColours = create<LandingColoursState>()((set) => ({
  grid: null,
  setLandingColours: (grid) => {
    const { cols, rows, rating } = grid
    if (Number.isInteger(cols) && Number.isInteger(rows) && cols > 0 && rows > 0 && rating.length === cols * rows) set({ grid })
  },
  // Leaves an empty store alone, so clearing with nothing drawn renders nothing.
  clearLandingColours: () => set((s) => (s.grid === null ? s : { grid: null })),
}))
