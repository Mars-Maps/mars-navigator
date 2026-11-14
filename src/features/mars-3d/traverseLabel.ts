import type { RoverId, RoverTraverse } from '../../domain'
import { solRange } from './traverseSols'

/** The rover's name as people write it. */
export const ROVER_NAME: Record<RoverId, string> = {
  perseverance: 'Perseverance',
  curiosity: 'Curiosity',
}

/** Why no path is drawn yet: not a failure, so it does not open the caption (`captionAlerts`). */
export const TRAVERSE_LOADING_REASON = 'the rover waypoints are still loading'

/**
 * Appended to a failed read's reason while another read is coming:
 * the caption shows the failure when opened, but a failure still being
 * retried does not open it; only one that stands does.
 */
export const TRAVERSE_RETRYING = 'trying again shortly'

/** A failed read's reason while the next try waits. */
export function retryingReason(reason: string): string {
  return `${reason}; ${TRAVERSE_RETRYING}`
}

export function isTraverseRetrying(reason: string): boolean {
  return reason.endsWith(TRAVERSE_RETRYING)
}

/**
 * The caption line for a drawn traverse: whose path, which sols the
 * feed covers, and when the live feed was read, so a stale read is
 * visible. The slider says which sol it is shown up to.
 */
export function traverseCaption(traverse: RoverTraverse): string {
  const read = new Date(traverse.retrievedUtcMs).toISOString().slice(0, 16).replace('T', ' ')
  const name = ROVER_NAME[traverse.rover]
  const range = solRange(traverse.points)
  if (range === null) return `${name}'s path: the feed read ${read} UTC has no waypoints`
  return `${name}'s path (solid line, straight between waypoints), sols ${range.first}–${range.last}, NASA/JPL waypoints read ${read} UTC; not a planned route`
}
