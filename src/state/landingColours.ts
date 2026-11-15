import { create } from 'zustand'
import type { SiteBounds } from '../domain'

/**
 * The landing rating as the globe draws it: one code per cell of a
 * lattice over a box, rows north to south, each west to east. The shell
 * rates the ground and sets it while the landing site is being picked; the
 * scene only draws it. More than one grid when the ground in view is rated
 * at two cell sizes: the site's sheet finely, the rest of the view coarsely. Its own store, like the site's ellipse, so
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
  /**
   * The grids to draw, the one on top first: where two cover the same
   * ground, only the first's rated cells show. Empty while nothing is to be drawn.
   */
  grids: readonly LandingColourGrid[]
  /** A grid whose size does not match its codes is refused with the rest, and nothing changes; so is no grid at all. */
  setLandingColours: (grids: readonly LandingColourGrid[]) => void
  clearLandingColours: () => void
}

const sound = ({ cols, rows, rating }: LandingColourGrid) =>
  Number.isInteger(cols) && Number.isInteger(rows) && cols > 0 && rows > 0 && rating.length === cols * rows

export const useLandingColours = create<LandingColoursState>()((set) => ({
  grids: [],
  setLandingColours: (grids) => {
    if (grids.length > 0 && grids.every(sound)) set({ grids })
  },
  // Leaves an empty store alone, so clearing with nothing drawn renders nothing.
  clearLandingColours: () => set((s) => (s.grids.length === 0 ? s : { grids: [] })),
}))
