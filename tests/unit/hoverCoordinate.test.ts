import { beforeEach, describe, expect, it } from 'vitest'
import { HOVER_DECIMALS, sameAtDecimals } from '../../src/features/mars-3d/hoverCompare'
import { useMissionStore } from '../../src/state'

const store = useMissionStore
const at = (latitude: number, longitudeEast: number) => ({ latitude, longitudeEast })

describe('sameAtDecimals', () => {
  it('treats a change below the shown precision as no change', () => {
    expect(sameAtDecimals(at(12.34, 200.04), at(12.26, 199.96), HOVER_DECIMALS)).toBe(true)
  })

  it('sees a change at the shown precision', () => {
    expect(sameAtDecimals(at(12.34, 200.0), at(12.36, 200.0), HOVER_DECIMALS)).toBe(false)
    expect(sameAtDecimals(at(12.3, 200.04), at(12.3, 200.06), HOVER_DECIMALS)).toBe(false)
  })

  it('compares null only with null', () => {
    expect(sameAtDecimals(null, null, HOVER_DECIMALS)).toBe(true)
    expect(sameAtDecimals(null, at(0, 0), HOVER_DECIMALS)).toBe(false)
    expect(sameAtDecimals(at(0, 0), null, HOVER_DECIMALS)).toBe(false)
  })
})

describe('setHoverCoordinate', () => {
  beforeEach(() => store.setState({ hoverCoordinate: null }))

  it('stores and clears the coordinate', () => {
    store.getState().setHoverCoordinate(at(-4.5, 137.4))
    expect(store.getState().hoverCoordinate).toEqual(at(-4.5, 137.4))
    store.getState().setHoverCoordinate(null)
    expect(store.getState().hoverCoordinate).toBeNull()
  })

  it('does not notify when the same value is written again', () => {
    let notified = 0
    const unsubscribe = store.subscribe(() => notified++)
    const c = at(1, 2)
    store.getState().setHoverCoordinate(c)
    store.getState().setHoverCoordinate(c)
    store.getState().setHoverCoordinate(null)
    store.getState().setHoverCoordinate(null)
    unsubscribe()
    expect(notified).toBe(2)
  })
})
