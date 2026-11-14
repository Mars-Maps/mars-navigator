import { beforeEach, describe, expect, it } from 'vitest'
import type { MarsCoordinate } from '../../src/domain'
import { useMissionStore } from '../../src/state'

// Test fixtures only: invented coordinates.
const S0: MarsCoordinate = { latitude: 0, longitudeEast: 0 }
const S1: MarsCoordinate = { latitude: 5, longitudeEast: 5 }
const S2: MarsCoordinate = { latitude: 10, longitudeEast: 10 }

const stops = () => useMissionStore.getState().routeDraft.stops
const actions = () => useMissionStore.getState()

/** Runs `move` and reports whether the store's state object changed. */
function changesState(move: () => void): boolean {
  const before = useMissionStore.getState()
  move()
  return useMissionStore.getState() !== before
}

describe('moveStop guards', () => {
  beforeEach(() => {
    actions().clearRoute()
    actions().addStop(S0)
    actions().addStop(S1)
    actions().addStop(S2)
  })

  it('ignores a move to the same index, without a new state', () => {
    expect(changesState(() => actions().moveStop(1, 1))).toBe(false)
    expect(stops()).toEqual([S0, S1, S2])
  })

  it.each([
    ['negative from', -1, 0],
    ['negative to', 0, -1],
    ['from past the end', 3, 0],
    ['to past the end', 0, 3],
    ['fractional from', 0.5, 2],
    ['fractional to', 0, 1.5],
    ['NaN from', Number.NaN, 0],
    ['NaN to', 0, Number.NaN],
    ['infinite to', 0, Number.POSITIVE_INFINITY],
  ])('ignores %s, without a new state', (_, from, to) => {
    expect(changesState(() => actions().moveStop(from, to))).toBe(false)
    expect(stops()).toEqual([S0, S1, S2])
  })

  it('ignores any move when there are no stops', () => {
    actions().clearRoute()
    expect(changesState(() => actions().moveStop(0, 0))).toBe(false)
    expect(changesState(() => actions().moveStop(0, 1))).toBe(false)
    expect(stops()).toEqual([])
  })
})

describe('moveStop with three stops', () => {
  beforeEach(() => {
    actions().clearRoute()
    actions().addStop(S0)
    actions().addStop(S1)
    actions().addStop(S2)
  })

  it('moves a stop forward, shifting the ones it passes back', () => {
    actions().moveStop(0, 2)
    expect(stops()).toEqual([S1, S2, S0])
  })

  it('moves a stop backward, shifting the ones it passes forward', () => {
    actions().moveStop(2, 0)
    expect(stops()).toEqual([S2, S0, S1])
  })

  it('moves between neighbours in the middle', () => {
    actions().moveStop(1, 2)
    expect(stops()).toEqual([S0, S2, S1])
  })

  it('keeps every stop exactly once', () => {
    for (const [from, to] of [[0, 2], [2, 1], [1, 0], [0, 1]] as const) {
      actions().moveStop(from, to)
      expect(stops()).toHaveLength(3)
      expect(new Set(stops())).toEqual(new Set([S0, S1, S2]))
    }
  })

  it('leaves the departure and destination alone', () => {
    actions().setDeparture(S0)
    actions().setDestination(S2)
    actions().moveStop(0, 2)
    const { departure, destination } = useMissionStore.getState().routeDraft
    expect(departure).toEqual(S0)
    expect(destination).toEqual(S2)
  })

  it('notifies a subscriber once, with the final order only', () => {
    const seen: (MarsCoordinate | null)[][] = []
    const unsubscribe = useMissionStore.subscribe((s) => seen.push(s.routeDraft.stops))
    try {
      actions().moveStop(0, 2)
    } finally {
      unsubscribe()
    }
    expect(seen).toEqual([[S1, S2, S0]])
  })

  it('does not notify a subscriber for an ignored move', () => {
    let calls = 0
    const unsubscribe = useMissionStore.subscribe(() => calls++)
    try {
      actions().moveStop(1, 1)
      actions().moveStop(0, 3)
    } finally {
      unsubscribe()
    }
    expect(calls).toBe(0)
  })
})
