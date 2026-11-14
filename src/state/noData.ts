/**
 * The one colour for "nothing is known here": the flat globe while
 * a layer loads or none is available, the fill under a layer's no-data
 * pixels where the shell could not draw the base map, and the surface
 * view's ground and overhead map before a tile arrives. The shell paints
 * the surface image and the scene shows it, so both read this constant and
 * cannot disagree. Dark and near-neutral, so it never reads as a surface
 * feature, and no transparent pixel is left for an opaque material to show
 * as black.
 */
export const NO_DATA_CSS = '#2a2622'
/** The same colour as a Three.js hex, for the untextured material. */
export const NO_DATA_HEX = 0x2a2622
