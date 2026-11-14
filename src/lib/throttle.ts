/**
 * Calls `fn` at most once per `intervalMs`, with the latest arguments.
 * The first call runs at once; calls during the interval are coalesced into
 * one trailing call at the end of it, so the final value always lands.
 * `cancel()` drops a pending trailing call (use it on unmount).
 */
export function throttleTrailing<A extends unknown[]>(
  fn: (...args: A) => void,
  intervalMs: number,
  now: () => number = () => Date.now(),
): { (...args: A): void; cancel(): void } {
  let last = Number.NEGATIVE_INFINITY
  let timer: ReturnType<typeof setTimeout> | null = null
  let pending: A | null = null

  const flush = () => {
    timer = null
    if (pending === null) return
    const args = pending
    pending = null
    last = now()
    fn(...args)
  }

  const throttled = (...args: A) => {
    const elapsed = now() - last
    if (elapsed >= intervalMs && timer === null) {
      last = now()
      fn(...args)
      return
    }
    pending = args
    if (timer === null) timer = setTimeout(flush, Math.max(0, intervalMs - elapsed))
  }
  throttled.cancel = () => {
    if (timer !== null) clearTimeout(timer)
    timer = null
    pending = null
  }
  return throttled
}
