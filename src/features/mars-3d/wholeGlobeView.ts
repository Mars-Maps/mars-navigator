import { START_CAMERA_ALTITUDE_KM } from './constants'

/**
 * What counts as the far view, for the shell's ten-second welcome return
 * and the thirty-second spin restart: one rule, so
 * the two waits agree. Kept free of Three.js, because the shell
 * imports it into the first load.
 */

/** The camera settles within 0.1 km of its goal; 1 km covers that. */
export const ALTITUDE_TOLERANCE_KM = 1

/**
 * The whole planet in view: at or above the camera's start altitude, where
 * the globe sits with room around it. Below that the view is close-up.
 */
export function isWholeGlobeView(
  altitudeKm: number,
  thresholdKm = START_CAMERA_ALTITUDE_KM,
): boolean {
  return Number.isFinite(altitudeKm) && altitudeKm >= thresholdKm - ALTITUDE_TOLERANCE_KM
}
