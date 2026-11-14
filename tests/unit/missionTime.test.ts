import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { startMissionClock, useMissionTimeStore } from '../../src/state/missionTime'

// A fixed epoch for the fake real clock; the instants are arbitrary.
const T0 = Date.UTC(2026, 9, 23, 12, 0, 0)
const store = useMissionTimeStore

beforeEach(() => {
  store.setState({ utcMs: T0, running: true, anchorUtcMs: T0, anchorRealMs: T0 })
})

describe('the mission clock runs', () => {
  it('advances by the real time elapsed since the instant was set, without drift', () => {
    store.getState().setInstant(T0 + 60_000, T0)
    store.getState().tick(T0 + 1000)
    expect(store.getState().utcMs).toBe(T0 + 61_000)
    store.getState().tick(T0 + 2500)
    expect(store.getState().utcMs).toBe(T0 + 62_500)
  })

  it('keeps running when a time is set, from the new instant', () => {
    store.getState().tick(T0 + 5000)
    store.getState().setInstant(T0 - 3_600_000, T0 + 5000)
    expect(store.getState().running).toBe(true)
    store.getState().tick(T0 + 6000)
    expect(store.getState().utcMs).toBe(T0 - 3_600_000 + 1000)
  })

  it('returns the same state from a tick that changes nothing, so nothing re-renders', () => {
    store.getState().tick(T0 + 1000)
    const before = store.getState()
    store.getState().tick(T0 + 1000)
    expect(store.getState()).toBe(before)
  })

  it('ignores a non-finite instant and keeps ticking from the old one', () => {
    store.getState().setInstant(Number.NaN, T0)
    store.getState().tick(T0 + 1000)
    expect(store.getState().utcMs).toBe(T0 + 1000)
  })

  it('ignores a non-finite tick, so a bad clock can never put NaN in the instant', () => {
    const before = store.getState()
    store.getState().tick(Number.NaN)
    expect(store.getState()).toBe(before)
  })
})

describe('pause and run', () => {
  it('freezes on pause: ticks change nothing', () => {
    store.getState().tick(T0 + 1000)
    store.getState().pause()
    const frozen = store.getState()
    store.getState().tick(T0 + 9000)
    expect(store.getState()).toBe(frozen)
    expect(store.getState().utcMs).toBe(T0 + 1000)
  })

  it('resumes from the frozen instant with no jump for the time spent paused', () => {
    store.getState().tick(T0 + 1000)
    store.getState().pause()
    store.getState().resume(T0 + 31_000)
    store.getState().tick(T0 + 32_000)
    expect(store.getState().utcMs).toBe(T0 + 2000)
  })

  it('is sticky: setting a time while paused moves the frozen clock and stays paused', () => {
    store.getState().pause()
    store.getState().setInstant(T0 + 500_000, T0 + 10_000)
    expect(store.getState().running).toBe(false)
    store.getState().tick(T0 + 20_000)
    expect(store.getState().utcMs).toBe(T0 + 500_000)
    store.getState().resume(T0 + 20_000)
    store.getState().tick(T0 + 21_000)
    expect(store.getState().utcMs).toBe(T0 + 501_000)
  })

  it('Set now returns to real time and runs, even when paused', () => {
    store.getState().pause()
    store.getState().setInstant(T0 - 86_400_000, T0)
    store.getState().setNow(T0 + 40_000)
    expect(store.getState()).toMatchObject({ utcMs: T0 + 40_000, running: true })
    store.getState().tick(T0 + 41_000)
    expect(store.getState().utcMs).toBe(T0 + 41_000)
  })
})

describe('startMissionClock', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('ticks once a second with the injected clock, and stops when told', () => {
    const ticks: number[] = []
    const fake = { getState: () => ({ tick: (now: number) => ticks.push(now) }) }
    let now = T0
    const stop = startMissionClock(fake, 1000, () => now)
    now = T0 + 1000
    vi.advanceTimersByTime(1000)
    now = T0 + 2000
    vi.advanceTimersByTime(1000)
    expect(ticks).toEqual([T0 + 1000, T0 + 2000])
    stop()
    vi.advanceTimersByTime(5000)
    expect(ticks).toHaveLength(2)
  })

  it('drives the real store by default, once per interval', () => {
    vi.setSystemTime(T0)
    store.setState({ utcMs: T0, running: true, anchorUtcMs: T0, anchorRealMs: T0 })
    const stop = startMissionClock()
    vi.advanceTimersByTime(3000)
    expect(store.getState().utcMs).toBe(T0 + 3000)
    stop()
  })
})
