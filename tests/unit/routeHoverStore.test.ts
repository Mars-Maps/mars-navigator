import { beforeEach, describe, expect, it } from 'vitest'
import { useRouteHover } from '../../src/state'

// Test fixture only — an invented point, not data.
const POINT = { coordinate: { latitude: 18.4, longitudeEast: 77.5 }, distanceKm: 3.2 }

describe('useRouteHover', () => {
  beforeEach(() => useRouteHover.setState({ hoveredRoutePoint: null }))

  it('starts with no hovered point', () => {
    expect(useRouteHover.getState().hoveredRoutePoint).toBeNull()
  })

  it('holds the point it is given, and clears on null', () => {
    useRouteHover.getState().setHoveredRoutePoint(POINT)
    expect(useRouteHover.getState().hoveredRoutePoint).toEqual(POINT)
    useRouteHover.getState().setHoveredRoutePoint(null)
    expect(useRouteHover.getState().hoveredRoutePoint).toBeNull()
  })

  it('has only its two members', () => {
    expect(Object.keys(useRouteHover.getState()).sort()).toEqual(['hoveredRoutePoint', 'setHoveredRoutePoint'])
  })
})
