import { create } from 'zustand'

/**
 * Colours a marked point can take. None is a route role's colour
 * (departure teal, stop grey, destination pink), a classification colour
 * (green, blue, amber, grey), the danger red, the rover path's magenta, the
 * profile tools' sky blue or the Measure line's white, so a recoloured
 * marked point never reads as one of those. Lavender, the first, is the
 * marked points' own colour and every point's until it is changed.
 */
export const MARKER_COLORS = [
  { id: 'lavender', label: 'Lavender', hex: 0xa5b4fc },
  { id: 'orange', label: 'Orange', hex: 0xfb923c },
  { id: 'lime', label: 'Lime', hex: 0xa3e635 },
  { id: 'indigo', label: 'Indigo', hex: 0x6366f1 },
] as const

export type MarkerColorId = (typeof MARKER_COLORS)[number]['id']

/** The hex colour of marked point `id`: its chosen colour, else lavender. */
export function markerHex(colors: Readonly<Record<string, MarkerColorId>>, id: string): number {
  return MARKER_COLORS.find((c) => c.id === colors[id])?.hex ?? MARKER_COLORS[0].hex
}

interface MarkerColorState {
  /** Chosen colours by marker id; a point not listed is lavender. Not persisted, as the markers are not. */
  colors: Readonly<Record<string, MarkerColorId>>
  setMarkerColor: (id: string, color: MarkerColorId) => void
}

/** Kept apart from the mission store: only the pins, the list and the menu read it. */
export const useMarkerColors = create<MarkerColorState>()((set) => ({
  colors: {},
  setMarkerColor: (id, color) =>
    set((s) => (s.colors[id] === color ? s : { colors: { ...s.colors, [id]: color } })),
}))
