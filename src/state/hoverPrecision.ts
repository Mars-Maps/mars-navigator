/**
 * Decimals in the hover readout. One decimal (0.1°, about 6 km)
 * was right while the camera could not come lower than 374 km. Since the
 * floor is 37 km, a screen holds about 16 km of ground there, so the
 * readout would barely change across it: below FINE_HOVER_BELOW_KM it shows
 * two decimals (0.01°, about 600 m), still coarser than a screen pixel, so
 * it claims no precision the pick does not have. Shared here because the
 * scene writes the hover coordinate and the readout prints it.
 */
export const FINE_HOVER_BELOW_KM = 100

/** The readout's decimals for a camera this high (km); one before the camera has settled. */
export function hoverDecimals(altitudeKm: number | null): number {
  return altitudeKm !== null && altitudeKm < FINE_HOVER_BELOW_KM ? 2 : 1
}
