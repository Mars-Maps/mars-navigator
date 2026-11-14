import { beforeEach, describe, expect, it } from 'vitest'
import type { MarsCoordinate } from '../../src/domain'
import { draftWaypoints, hasRouteLine } from '../../src/features/mars-3d/routeGeometry'
import { toRouteRequest, useMissionStore } from '../../src/state'

// Test fixtures only: invented coordinates.
const A: MarsCoordinate = { latitude: 0, longitudeEast: 0 }
const B: MarsCoordinate = { latitude: 5, longitudeEast: 5 }
const C: MarsCoordinate = { latitude: 10, longitudeEast: 10 }
const D: MarsCoordinate = { latitude: 15, longitudeEast: 15 }

const draft = () => useMissionStore.getState().routeDraft
const actions = () => useMissionStore.getState()

describe('an invalid stop in the route draft', () => {
  beforeEach(() => {
    actions().clearRoute()
    actions().setDeparture(A)
    actions().setDestination(D)
    actions().addStop(B)
  })

  it('replaces the stop with null instead of keeping the last valid value', () => {
    actions().updateStop(0, null)
    expect(draft().stops).toEqual([null])
  })

  it('keeps the route request null while any stop is null', () => {
    expect(toRouteRequest(draft())).toEqual({ departure: A, destination: D, stops: [B] })
    actions().updateStop(0, null)
    expect(toRouteRequest(draft())).toBeNull()
  })

  it('becomes a request again once the stop is valid', () => {
    actions().updateStop(0, null)
    actions().updateStop(0, C)
    expect(toRouteRequest(draft())).toEqual({ departure: A, destination: D, stops: [C] })
  })

  it('becomes a request again once the null stop is removed', () => {
    actions().addStop(C)
    actions().updateStop(0, null)
    actions().removeStop(0)
    expect(toRouteRequest(draft())).toEqual({ departure: A, destination: D, stops: [C] })
  })

  it('moves a null stop like any other, so it stays with its row', () => {
    actions().addStop(C)
    actions().updateStop(0, null)
    actions().moveStop(0, 1)
    expect(draft().stops).toEqual([C, null])
    expect(toRouteRequest(draft())).toBeNull()
  })

  it('ignores an index outside the stops, null or not', () => {
    actions().updateStop(5, null)
    expect(draft().stops).toEqual([B])
  })
})

describe('the globe overlay skips a null stop', () => {
  it('draws no pin for it and joins the remaining waypoints in order', () => {
    const points = draftWaypoints({ departure: A, stops: [B, null, C], destination: D })
    expect(points.map((p) => p.coordinate)).toEqual([A, B, C, D])
    expect(points.map((p) => p.kind)).toEqual(['departure', 'stop', 'stop', 'destination'])
  })

  it('does not count it towards a line', () => {
    expect(hasRouteLine({ departure: A, stops: [null], destination: null })).toBe(false)
    expect(hasRouteLine({ departure: null, stops: [null, null], destination: null })).toBe(false)
    expect(hasRouteLine({ departure: A, stops: [null, B], destination: null })).toBe(true)
  })
})
