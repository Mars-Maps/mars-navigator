import { formatMarsCoordinate, type MarsCoordinate } from '../../domain'
import type { CoordinateTableState } from '../../state'

/**
 * Decimals in the coordinate table. 0.001° is about 59 m on the
 * equator. One screen pixel at the closest zoom is about 15–23 m
 * (scaleBarMath at MIN_CAMERA_ALTITUDE_KM with the 25° lens, over 1080–720
 * px), so a pick there is good to about three pixels at three decimals; the
 * pick is on the mean-radius sphere and the picture is drawn a little above
 * it, so more digits would claim a precision it does not have.
 */
export const TABLE_DECIMALS = 3

export const TABLE_METHOD =
  'Surface point under the right-click, from the pick ray on the mean-radius sphere'

/** The method line for a point the user typed in the menu: their own input, not derived. */
export const TABLE_TYPED_METHOD = 'Entered in the right-click menu'

/** Only for a pick: it is about the precision of the click. */
export const TABLE_PRECISION_NOTE =
  'Three decimals (0.001° ≈ 59 m at the equator): a few screen pixels at the closest zoom, about as fine as a click on the mean-radius sphere places a point, so more digits would not be more accurate.'

export interface CoordinateRows {
  /** Planetocentric latitude, e.g. "4.587°S". */
  latitude: string
  /** Degrees east, 0–360, e.g. "350.000°E". */
  longitudeEast: string
  /** The same longitude in ±180, e.g. "10.000°W". For reading only: the search bar takes 0–360. */
  longitudeSigned: string
  /** The form "Copy" puts on the clipboard; pastes back into the search bar. */
  copyable: string
}

/**
 * Whether the open table shows `point` from `source`: the menu then
 * offers Collapse; for any other point or source, Expand replaces what the
 * table shows. Exact, since the table holds the menu's own value: the pick,
 * or the coordinate parsed from the same typed text.
 */
export function tableShows(
  table: CoordinateTableState | null,
  point: MarsCoordinate,
  source: CoordinateTableState['source'],
): boolean {
  return (
    table !== null &&
    table.source === source &&
    table.point.latitude === point.latitude &&
    table.point.longitudeEast === point.longitudeEast
  )
}

/**
 * The table's rows for one coordinate. Every row comes from the one display
 * format, rounded once, so the rows always agree with the copied text: a
 * longitude that rounds to 360 reads 0.000°E (and 0.000°E in ±180), never
 * 360.000°E, and a latitude that rounds to zero never reads −0.000.
 */
export function coordinateRows(c: MarsCoordinate): CoordinateRows {
  const copyable = formatMarsCoordinate(c, TABLE_DECIMALS)
  const [latitude, longitudeEast] = copyable.split(' ')
  // Parsed back from the rounded text, so ±180 uses the same rounding.
  const east = Number.parseFloat(longitudeEast)
  const longitudeSigned =
    east > 180 ? `${(360 - east).toFixed(TABLE_DECIMALS)}°W` : longitudeEast
  return { latitude, longitudeEast, longitudeSigned, copyable }
}
