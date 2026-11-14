import {
  columnMassFraction,
  derived,
  isAvailable,
  SHIELDING_METHOD,
  unavailable,
  type Classified,
  type MarsCoordinate,
} from '../domain'

/**
 * The atmosphere overhead at a point as a fraction of Gale's, from
 * its elevation by the domain's rule: DERIVED, the
 * method naming the elevation's own source. No elevation, no fraction:
 * UNAVAILABLE with the elevation's reason, never Gale's 1.
 */
export function shieldingFromElevation(elevationM: Classified<number>): Classified<number> {
  if (!isAvailable(elevationM)) return unavailable(`No elevation at this point: ${elevationM.reason}`)
  const fraction = columnMassFraction(elevationM.value)
  if (!Number.isFinite(fraction)) return unavailable('The elevation at this point is not a finite number')
  const from = elevationM.classification === 'DERIVED' ? elevationM.method : elevationM.source
  return derived(fraction, `${SHIELDING_METHOD}. Elevation here: ${from}`)
}

/** One elevation read for the selected point, and the shielding derived from it. */
export interface PointRead {
  at: MarsCoordinate
  elevation: Classified<number>
  shielding: Classified<number>
}

/**
 * The read to show for `point`: only one made for that very selection, so a
 * previous point's values never show under a new one while its read is out.
 */
export function readFor(read: PointRead | null, point: MarsCoordinate | null): PointRead | null {
  return point !== null && read?.at === point ? read : null
}
