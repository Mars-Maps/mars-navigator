import { beforeEach, describe, expect, it } from 'vitest'
import type { MarsCoordinate, RouteOption } from '../../src/domain'
import { canTransition, useMissionStore, type ViewMode } from '../../src/state'

const store = useMissionStore
const spot: MarsCoordinate = { latitude: -4.6, longitudeEast: 137.4 }
// Test fixture only: a route with no path, enough for the store to call it followed.
const ROUTE: RouteOption = {
  id: 'fixture-route',
  strategy: 'shortest',
  points: [],
  path: { classification: 'UNAVAILABLE', reason: 'fixture' },
  metrics: {
    distanceKm: { classification: 'UNAVAILABLE', reason: 'fixture' },
    durationHours: { classification: 'UNAVAILABLE', reason: 'fixture' },
    metabolicEnergyKcal: { classification: 'UNAVAILABLE', reason: 'fixture' },
  },
  hazards: { classification: 'UNAVAILABLE', reason: 'fixture' },
}
const other: MarsCoordinate = { latitude: 18.4, longitudeEast: 77.5 }

const reset = (viewMode: ViewMode) =>
  store.setState({
    viewMode,
    surfaceSpot: null,
    introDismissed: viewMode !== 'welcome',
    hoverCoordinate: spot,
    contextMenu: { coordinate: spot, anchor: { x: 10, y: 10 } },
  })

describe('surface view mode transitions', () => {
  it('is entered from welcome, close-up and navigation, and left to close-up or navigation', () => {
    expect(canTransition('welcome', 'surface')).toBe(true)
    expect(canTransition('close-up', 'surface')).toBe(true)
    expect(canTransition('navigation', 'surface')).toBe(true)
    expect(canTransition('surface', 'close-up')).toBe(true)
    expect(canTransition('surface', 'welcome')).toBe(false)
    expect(canTransition('surface', 'navigation')).toBe(true)
  })

  it('the whole table: every other move is as before', () => {
    const modes: ViewMode[] = ['welcome', 'close-up', 'navigation', 'surface']
    const allowed = new Set([
      'welcome→close-up', 'welcome→surface',
      'close-up→welcome', 'close-up→navigation', 'close-up→surface',
      'navigation→close-up', 'navigation→surface',
      'surface→close-up', 'surface→navigation',
    ])
    for (const from of modes) for (const to of modes) {
      expect(canTransition(from, to), `${from}→${to}`).toBe(from === to || allowed.has(`${from}→${to}`))
    }
  })
})

describe('enterSurface and leaveSurface', () => {
  beforeEach(() => reset('close-up'))

  it.each(['welcome', 'close-up'] as const)('stands at the spot from %s', (mode) => {
    reset(mode)
    store.getState().enterSurface(spot)
    const s = store.getState()
    expect(s.viewMode).toBe('surface')
    expect(s.surfaceSpot).toEqual(spot)
  })

  it('closes the hover readout and the right-click menu, which belong to the globe', () => {
    store.getState().enterSurface(spot)
    expect(store.getState().hoverCoordinate).toBeNull()
    expect(store.getState().contextMenu).toBeNull()
  })

  it('turns "Hide all tools" off, since its switch is in the globe\'s menu', () => {
    store.setState({ toolsHidden: true })
    store.getState().enterSurface(spot)
    expect(store.getState().toolsHidden).toBe(false)
  })

  it.each([
    ['a NaN latitude', { latitude: Number.NaN, longitudeEast: 10 }],
    ['a latitude past the pole', { latitude: 91, longitudeEast: 10 }],
    ['a longitude past 360°E', { latitude: 0, longitudeEast: 361 }],
  ])('refuses %s and stays where it was', (_, bad) => {
    store.getState().enterSurface(bad)
    expect(store.getState().viewMode).toBe('close-up')
    expect(store.getState().surfaceSpot).toBeNull()
  })

  it('stands from navigation with the route kept, and remembers to return there', () => {
    reset('navigation')
    store.setState({ activeRoute: ROUTE })
    store.getState().enterSurface(spot)
    const s = store.getState()
    expect(s.viewMode).toBe('surface')
    expect(s.surfaceSpot).toEqual(spot)
    expect(s.surfaceReturn).toBe('navigation')
    expect(s.activeRoute).toBe(ROUTE)
  })

  it('from close-up or welcome it returns to close-up', () => {
    for (const mode of ['welcome', 'close-up'] as const) {
      reset(mode)
      store.getState().enterSurface(spot)
      expect(store.getState().surfaceReturn).toBe('close-up')
      store.getState().leaveSurface()
      expect(store.getState().viewMode).toBe('close-up')
    }
  })

  it('leaving goes back to navigation, the route still followed', () => {
    reset('navigation')
    store.setState({ activeRoute: ROUTE })
    store.getState().enterSurface(spot)
    store.getState().leaveSurface()
    const s = store.getState()
    expect(s.viewMode).toBe('navigation')
    expect(s.activeRoute).toBe(ROUTE)
    expect(s.surfaceSpot).toBeNull()
  })

  it('keeps the drop note with the spot and clears it on leaving or a teleport', () => {
    store.getState().enterSurface(spot, 'Snapped to the route, 120 m')
    expect(store.getState().surfaceNote).toBe('Snapped to the route, 120 m')
    store.getState().enterSurface(other)
    expect(store.getState().surfaceNote).toBeNull()
    store.getState().enterSurface(other, 'Snapped to the route, 5 m')
    store.getState().leaveSurface()
    expect(store.getState().surfaceNote).toBeNull()
  })

  it('a teleport keeps where leaving returns to', () => {
    reset('navigation')
    store.setState({ activeRoute: ROUTE })
    store.getState().enterSurface(spot)
    store.getState().enterSurface(other)
    expect(store.getState().surfaceReturn).toBe('navigation')
    store.getState().leaveSurface()
    expect(store.getState().viewMode).toBe('navigation')
  })

  it('startNavigation does not fire from the surface, though the move is in the table', () => {
    reset('close-up')
    store.setState({ activeRoute: null })
    store.getState().enterSurface(spot)
    store.getState().startNavigation([ROUTE])
    expect(store.getState().viewMode).toBe('surface')
    expect(store.getState().activeRoute).toBeNull()
  })

  it('falls back to close-up when the route is gone meanwhile', () => {
    reset('navigation')
    store.setState({ activeRoute: ROUTE })
    store.getState().enterSurface(spot)
    store.setState({ activeRoute: null })
    store.getState().leaveSurface()
    expect(store.getState().viewMode).toBe('close-up')
  })

  it('moves the walker when entered again from surface', () => {
    store.getState().enterSurface(spot)
    store.getState().enterSurface(other)
    expect(store.getState().viewMode).toBe('surface')
    expect(store.getState().surfaceSpot).toEqual(other)
  })

  it('goes back to close-up and clears the spot', () => {
    store.getState().enterSurface(spot)
    store.getState().leaveSurface()
    expect(store.getState().viewMode).toBe('close-up')
    expect(store.getState().surfaceSpot).toBeNull()
  })

  it('leaveSurface does nothing outside surface', () => {
    store.getState().leaveSurface()
    expect(store.getState().viewMode).toBe('close-up')
  })

  it('setViewMode cannot enter surface without a spot', () => {
    store.getState().setViewMode('surface')
    expect(store.getState().viewMode).toBe('close-up')
    expect(store.getState().surfaceSpot).toBeNull()
  })

  it('clears the spot when setViewMode leaves surface', () => {
    store.getState().enterSurface(spot)
    store.getState().setViewMode('close-up')
    expect(store.getState().surfaceSpot).toBeNull()
  })

  it('ignores a move surface cannot make, and keeps the spot', () => {
    store.getState().enterSurface(spot)
    store.getState().setViewMode('welcome')
    expect(store.getState().viewMode).toBe('surface')
    expect(store.getState().surfaceSpot).toEqual(spot)
  })
})
