import { parseMarsCoordinate, type MarsCoordinate } from '../../domain'

/**
 * A point typed as two fields: X is longitude, degrees east 0–360,
 * Y is latitude, −90 to 90. Each axis goes through the domain's own parser,
 * so the number format and the range rule (validateCoordinate) are the ones
 * every other input uses. Nothing is clamped, wrapped or rounded.
 */
export interface PairCheck {
  /** The point, or null when the pair is empty, half filled or invalid. */
  coordinate: MarsCoordinate | null
  /** What to fix, shown under the pair; null when there is nothing to fix. */
  error: string | null
  invalidX: boolean
  invalidY: boolean
}

export const X_FORMAT_ERROR = 'X is the longitude in degrees east, e.g. 137.4'
export const X_RANGE_ERROR = 'X (longitude) must be 0 to under 360 °E'
export const Y_FORMAT_ERROR = 'Y is the latitude in degrees, e.g. −4.6'
export const Y_RANGE_ERROR = 'Y (latitude) must be between −90 and 90'
export const BOTH_NEEDED_ERROR = 'Enter both X and Y'
export const REQUIRED_ERROR = 'Enter X and Y, or remove this stop'

export function checkPair(xText: string, yText: string, required = false): PairCheck {
  const x = xText.trim()
  const y = yText.trim()
  if (x === '' && y === '') {
    return { coordinate: null, error: required ? REQUIRED_ERROR : null, invalidX: required, invalidY: required }
  }
  if (x === '' || y === '') {
    return { coordinate: null, error: BOTH_NEEDED_ERROR, invalidX: x === '', invalidY: y === '' }
  }
  // One axis at a time, the other held at a valid 0, so the reason names it.
  const xCheck = parseMarsCoordinate(`0, ${x}`)
  const yCheck = parseMarsCoordinate(`${y}, 0`)
  const errors: string[] = []
  if (!yCheck.ok) errors.push(yCheck.reason === 'format' ? Y_FORMAT_ERROR : Y_RANGE_ERROR)
  if (!xCheck.ok) errors.push(xCheck.reason === 'format' ? X_FORMAT_ERROR : X_RANGE_ERROR)
  if (errors.length > 0) {
    return { coordinate: null, error: errors.join('. '), invalidX: !xCheck.ok, invalidY: !yCheck.ok }
  }
  const both = parseMarsCoordinate(`${y}, ${x}`)
  return both.ok
    ? { coordinate: both.coordinate, error: null, invalidX: false, invalidY: false }
    : // Unreachable while each axis passed on its own; never coerce if it happens.
      { coordinate: null, error: BOTH_NEEDED_ERROR, invalidX: true, invalidY: true }
}

/**
 * A whole point in one field's text: "lat, lon", or the copied form
 * "4.6°S 137.4°E". Pasted or typed into either field, it fills both.
 */
export function wholePoint(text: string): MarsCoordinate | null {
  const parsed = parseMarsCoordinate(text)
  return parsed.ok ? parsed.coordinate : null
}

/**
 * One axis as editable text, not a display format (that is
 * formatMarsCoordinate). Rounded to 4 decimals (about 6 m on Mars) with
 * trailing zeros dropped, so tiny values never print as `1e-7`, which the
 * parser rejects.
 */
export function axisText(n: number): string {
  return String(Number(n.toFixed(4)))
}

/** Both fields' text for a point from the store; empty for none. */
export function pairText(c: MarsCoordinate | null): { x: string; y: string } {
  return c ? { x: axisText(c.longitudeEast), y: axisText(c.latitude) } : { x: '', y: '' }
}
