import type { MarsCoordinate } from '../../domain'

/** The hover readout's decimals above 100 km; a smaller change is not a change (`hoverDecimals`, for below). */
export const HOVER_DECIMALS = 1

/** The geologic unit under the cursor needs more: three decimals, about 60 m. */
export const UNIT_HOVER_DECIMALS = 3

/** True when both coordinates print the same at `decimals`. */
export function sameAtDecimals(
  a: MarsCoordinate | null,
  b: MarsCoordinate | null,
  decimals: number,
): boolean {
  if (a === null || b === null) return a === b
  const f = 10 ** decimals
  return (
    Math.round(a.latitude * f) === Math.round(b.latitude * f) &&
    Math.round(a.longitudeEast * f) === Math.round(b.longitudeEast * f)
  )
}
