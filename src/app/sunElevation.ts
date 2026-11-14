import { derived, isAvailable, unavailable, type Classified, type MarsCoordinate } from '../domain'
import { skyAt } from '../features/mars-3d/sky/skyPositions'

/**
 * The sun's elevation where the walker stands, for the HUD: the same
 * placement the surface view's sky draws, so the two never disagree. DERIVED,
 * or UNAVAILABLE with the reason.
 */
export function sunElevationAt(utcMs: number, position: Classified<MarsCoordinate>): Classified<number> {
  if (!isAvailable(position)) return unavailable(`No sun elevation without a position: ${position.reason}`)
  const sun = skyAt(utcMs, position.value).find((body) => body.id === 'sun')
  if (!sun) return unavailable('The sky has no sun at this time')
  const { placement } = sun
  if (placement.classification === 'UNAVAILABLE') return unavailable(placement.reason)
  const from = placement.classification === 'DERIVED' ? placement.method : placement.source
  return derived(placement.value.altitudeDeg, `Altitude of the sun as the surface view's sky places it: ${from}`)
}
