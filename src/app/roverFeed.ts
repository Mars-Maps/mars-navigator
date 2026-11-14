import { loadRoverTraverse } from '../data/adapters/TraverseAdapter'
import { unavailable, type Classified, type RoverId, type RoverTraverse } from '../domain'

type Read<T> = (signal: AbortSignal) => Promise<Classified<T>>

const ABANDONED = 'The read was abandoned'

/** `answer`, or UNAVAILABLE as soon as `signal` aborts: this reader leaves, the read goes on for the others. */
function untilAborted<T>(answer: Promise<Classified<T>>, signal: AbortSignal): Promise<Classified<T>> {
  return new Promise((resolve) => {
    const leave = () => resolve(unavailable(ABANDONED))
    signal.addEventListener('abort', leave, { once: true })
    void answer.then((a) => {
      signal.removeEventListener('abort', leave)
      resolve(a)
    })
  })
}

/**
 * One read for every reader. Readers at the same time share one
 * request, and an answer with a value is kept for the page's life, so all of
 * them see the same version. An UNAVAILABLE answer is given to those waiting
 * and not kept, so the next reader tries again. The request takes no reader's
 * signal, because another reader may still want it.
 */
export function shareRead<T>(read: Read<T>): Read<T> {
  let kept: Classified<T> | null = null
  let running: Promise<Classified<T>> | null = null
  return (signal) => {
    if (signal.aborted) return Promise.resolve(unavailable(ABANDONED))
    if (kept) return Promise.resolve(kept)
    running ??= read(new AbortController().signal)
      .catch((e: unknown) => unavailable<T>(e instanceof Error ? e.message : String(e)))
      .then((answer) => {
        running = null
        if (answer.classification !== 'UNAVAILABLE') kept = answer
        return answer
      })
    return untilAborted(running, signal)
  }
}

const READS: Record<RoverId, Read<RoverTraverse>> = {
  perseverance: shareRead((signal) => loadRoverTraverse('perseverance', signal)),
  curiosity: shareRead((signal) => loadRoverTraverse('curiosity', signal)),
}

/** A rover's traverse from the page's one read of its feed: the path on the globe and the walk planner both use it. */
export function readRoverTraverse(rover: RoverId, signal: AbortSignal): Promise<Classified<RoverTraverse>> {
  return READS[rover](signal)
}
