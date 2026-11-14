import { useState } from 'react'
import type { RoverTraverse } from '../../domain'
import { pointsThroughSol, solRange } from './traverseSols'

/**
 * The sol the rover's path is shown up to, local to the globe:
 * photos and distances do not read it.
 * Null follows the feed's last sol, so a fresh read shows the whole path.
 */
export function useTraverseSol(traverse: RoverTraverse | null) {
  const [chosen, setChosen] = useState<number | null>(null)
  const range = traverse ? solRange(traverse.points) : null
  // A chosen sol outside a new read's range falls back to its last sol.
  const sol =
    range === null
      ? null
      : chosen !== null && chosen >= range.first && chosen <= range.last
        ? chosen
        : range.last
  const count = traverse && sol !== null ? pointsThroughSol(traverse.points, sol) : 0
  return { range, sol, count, setSol: setChosen }
}
