import { Color } from 'three'
import type { GeologicUnit } from '../../domain'

/** For a unit the map gives no colour for: grey, so a colour on screen is always the map's. */
const NEUTRAL = new Color('#9a9a9a')

/**
 * The fill for a unit: the colour the map publishes for it, which the
 * adapter reads from the map's legend, never one of our own.
 */
export function unitColor(unit: GeologicUnit): Color {
  return unit.color ? new Color(unit.color) : NEUTRAL
}
