import { useEffect, useState } from 'react'
import { unavailable, type Classified, type RoverId, type RoverTraverse } from '../domain'
import { TRAVERSE_LOADING_REASON, retryingReason } from '../features/mars-3d/traverseLabel'
import { readRoverTraverse } from './roverFeed'

/** The waits before each new read of a failed feed, ms: a project choice, for a 503 that passes. */
export const TRAVERSE_RETRY_DELAYS_MS: readonly number[] = [5_000, 20_000, 60_000]

/** Said once the retries run out, so a failure that stands says it stands. */
export const NOT_READ_AGAIN = 'Not tried again until the page is reloaded'

/** Resolves after `ms`, or at once when aborted. */
function wait(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const done = () => {
      clearTimeout(timer)
      signal.removeEventListener('abort', done)
      resolve()
    }
    const timer = setTimeout(done, ms)
    signal.addEventListener('abort', done)
  })
}

/**
 * Reads until an answer holds a path or `delaysMs` runs out, giving each
 * answer to `onAnswer`, so a failure is said while the next try waits, marked
 * as retrying so the caption does not open for it. The last failure
 * says no more tries follow instead. An aborted read gives nothing.
 */
export async function readWithRetries(
  read: () => Promise<Classified<RoverTraverse>>,
  onAnswer: (answer: Classified<RoverTraverse>) => void,
  signal: AbortSignal,
  delaysMs: readonly number[] = TRAVERSE_RETRY_DELAYS_MS,
  pause: (ms: number, signal: AbortSignal) => Promise<void> = wait,
): Promise<void> {
  for (let attempt = 0; ; attempt++) {
    const answer = await read()
    if (signal.aborted) return
    if (answer.classification !== 'UNAVAILABLE') return onAnswer(answer)
    if (attempt >= delaysMs.length) return onAnswer(unavailable(`${answer.reason}. ${NOT_READ_AGAIN}`))
    onAnswer(unavailable(retryingReason(answer.reason)))
    await pause(delaysMs[attempt], signal)
    if (signal.aborted) return
  }
}

/**
 * A rover's path for the globe and the surface view. A read
 * abandoned on unmount writes nothing. Until it answers, and if it fails, the
 * path is UNAVAILABLE with the reason, so the caption says why none is drawn;
 * a failed read is tried again a few times before it stands.
 */
export function useRoverTraverse(rover: RoverId): Classified<RoverTraverse> {
  const [traverse, setTraverse] = useState<Classified<RoverTraverse>>(() => unavailable(TRAVERSE_LOADING_REASON))
  useEffect(() => {
    const controller = new AbortController()
    void readWithRetries(() => readRoverTraverse(rover, controller.signal), setTraverse, controller.signal)
    return () => controller.abort()
  }, [rover])
  return traverse
}
