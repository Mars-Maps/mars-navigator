/** The overhead map's sizes and thresholds: split from OverheadMap.tsx to keep it under the 500-line limit. */
import { MARS_MEAN_RADIUS_KM } from '../../../domain'

/**
 * The small map's side, CSS px, and the ground across it when it opens, km:
 * the closest it zooms, so walking moves the walker's dot visibly.
 */
export const SMALL_PX = 200
export const SMALL_SPAN_KM = 5
/** Ground across the expanded window when it opens, km: wide enough to see the region. */
export const OPEN_SPAN_KM = 600
/** The closest either map zooms, km across the window: about the ground picture's detail. */
export const CLOSEST_SPAN_KM = 5
export const KM_PER_DEG = (Math.PI * MARS_MEAN_RADIUS_KM) / 180
/** A press that moves less than this is a click, not a drag, CSS px. */
export const CLICK_SLOP_PX = 4
/** How often the walker's marker is redrawn while nothing else changes, ms. */
export const WALKER_REDRAW_MS = 250
export const GRIP_STEP_PX = 16
/** The panel's padding, title row, the gaps and two caption lines, so its mark always shows, CSS px. */
export const HEADER_AND_PADDING_PX = 106
