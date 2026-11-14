/** Which of a ramp legend's stops get their value written under the bar. */

/** Two labels closer than this share of the bar would overlap at the legend's width. */
export const LABEL_GAP_PERCENT = 11

/** Shown in place of the bar when a ramp legend lists no colour stops. */
export const NO_RAMP_STOPS = 'This legend lists no colour stops, so no colour scale can be drawn'

/**
 * The stops whose values are written under the bar: the ends always, and
 * between them every stop far enough from the last one written; a stop too
 * near the end gives way to it. Colours still show every stop.
 */
export function labelledStops(stops: readonly { value: number }[]): { value: number; at: number }[] {
  if (stops.length === 0) return []
  const lo = stops[0].value
  const span = stops[stops.length - 1].value - lo
  const at = (v: number) => (span > 0 ? ((v - lo) / span) * 100 : 0)
  const out = [{ value: lo, at: 0 }]
  for (let i = 1; i < stops.length - 1; i++) {
    const pos = at(stops[i].value)
    if (pos - out[out.length - 1].at >= LABEL_GAP_PERCENT && 100 - pos >= LABEL_GAP_PERCENT) out.push({ value: stops[i].value, at: pos })
  }
  if (stops.length > 1) out.push({ value: stops[stops.length - 1].value, at: 100 })
  return out
}

