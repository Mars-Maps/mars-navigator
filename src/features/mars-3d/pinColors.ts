/**
 * Role colours for route and marked-point pins, shared by the globe's pins
 * (RouteOverlay) and the surface view's overhead map so the two
 * cannot drift apart. Deliberately not the classification colours: green,
 * blue, amber and grey already mean OFFICIAL, DERIVED, SIMULATED and
 * UNAVAILABLE.
 */
export const ROUTE_PIN_COLOR = {
  departure: 0x2dd4bf,
  stop: 0xe5e7eb,
  destination: 0xf472b6,
  marked: 0xa5b4fc,
} as const

/**
 * The profile tools' clicked points, their line and their
 * region's outline and fill: sky blue, not a route role, the Measure line's
 * white, the traverse's magenta or a classification colour.
 */
export const TERRAIN_POINT_COLOR = 0x7dd3fc

/**
 * The rover's driven path, on the globe and the overhead map. Not a
 * route role, a classification colour, the danger red or the accent: it
 * has to read as "where the rover went", never as the planned walk. The
 * path is also solid where the route is dotted, so colour is not the only
 * difference.
 */
export const TRAVERSE_COLOR = 0xe879f9

/**
 * The followed route's line: the globe's path dots (pathDots.ts) and, on the
 * surface view's ground, its dashes. Pale dust: warm, light, and none
 * of the classification colours; the planned walk's dashes are white, so the
 * two never look alike where both are drawn.
 */
export const ROUTE_TRAIL_COLOR = 0xf3e3c3

/** `0x2dd4bf` as `#2dd4bf`, for a 2D canvas. */
export function cssColor(hex: number): string {
  return `#${hex.toString(16).padStart(6, '0')}`
}
