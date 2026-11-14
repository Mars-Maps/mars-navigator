import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { throttleTrailing } from '../../src/lib/throttle'

describe('throttleTrailing', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  const make = () => {
    const calls: number[] = []
    const t = throttleTrailing((v: number) => calls.push(v), 50, () => Date.now())
    return { calls, t }
  }

  it('runs the first call at once', () => {
    const { calls, t } = make()
    t(1)
    expect(calls).toEqual([1])
  })

  it('coalesces calls inside the interval into one trailing call with the latest value', () => {
    const { calls, t } = make()
    t(1)
    vi.advanceTimersByTime(10)
    t(2)
    t(3)
    expect(calls).toEqual([1])
    vi.advanceTimersByTime(40)
    expect(calls).toEqual([1, 3])
  })

  it('runs at once again after the interval has passed', () => {
    const { calls, t } = make()
    t(1)
    vi.advanceTimersByTime(60)
    t(2)
    expect(calls).toEqual([1, 2])
  })

  it('never calls more often than the interval under a stream', () => {
    const calls: number[] = []
    const stamps: number[] = []
    const stamped = throttleTrailing((v: number) => {
      calls.push(v)
      stamps.push(Date.now())
    }, 50)
    for (let ms = 0; ms < 500; ms += 5) {
      stamped(ms)
      vi.advanceTimersByTime(5)
    }
    vi.advanceTimersByTime(50)
    // One immediate call, then one trailing call per 50 ms window.
    expect(calls).toHaveLength(11)
    expect(calls[calls.length - 1]).toBe(495)
    for (let i = 1; i < stamps.length; i++) expect(stamps[i] - stamps[i - 1]).toBeGreaterThanOrEqual(50)
  })

  it('cancel drops the pending trailing call', () => {
    const { calls, t } = make()
    t(1)
    t(2)
    t.cancel()
    vi.advanceTimersByTime(100)
    expect(calls).toEqual([1])
  })
})
