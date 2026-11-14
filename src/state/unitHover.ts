import { create } from 'zustand'
import type { MarsCoordinate } from '../domain'

/**
 * The cursor's place on the globe, finer than `hoverCoordinate`'s one decimal,
 * for naming the geologic unit under it (units are far smaller than
 * 0.1°) and for the profile tools' preview line and region, which follow the
 * cursor to within the three decimals, about 60 m, and so end where the click
 * lands. Written only while the geology layer or a profile tool is
 * active, so nothing re-renders for it otherwise. Null off the globe.
 */
export const useUnitHover = create<{ at: MarsCoordinate | null; setAt: (at: MarsCoordinate | null) => void }>()((set) => ({
  at: null,
  setAt: (at) => set({ at }),
}))
