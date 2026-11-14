import { beforeEach, describe, expect, it } from 'vitest'
import type { MarsCoordinate } from '../../src/domain'
import { useMissionStore, type ViewMode } from '../../src/state'

const store = useMissionStore
const gale: MarsCoordinate = { latitude: -4.6, longitudeEast: 137.4 }
const jezero: MarsCoordinate = { latitude: 18.4, longitudeEast: 77.5 }

const reset = (viewMode: ViewMode) =>
  store.setState({ viewMode, coordinateTable: null, surfaceSpot: null, activeRoute: null })

describe('coordinate table store', () => {
  beforeEach(() => reset('close-up'))

  it.each(['close-up', 'navigation'] as const)('opens for a point in %s', (mode) => {
    reset(mode)
    store.getState().openCoordinateTable(gale, 'pick')
    expect(store.getState().coordinateTable).toEqual({ point: gale, source: 'pick' })
  })

  it('replaces the point it shows when opened for another', () => {
    store.getState().openCoordinateTable(gale, 'pick')
    store.getState().openCoordinateTable(jezero, 'pick')
    expect(store.getState().coordinateTable).toEqual({ point: jezero, source: 'pick' })
  })

  it('keeps a typed point as typed, and a pick replacing it as a pick', () => {
    store.getState().openCoordinateTable(gale, 'typed')
    expect(store.getState().coordinateTable).toEqual({ point: gale, source: 'typed' })
    store.getState().openCoordinateTable(gale, 'pick')
    expect(store.getState().coordinateTable).toEqual({ point: gale, source: 'pick' })
  })

  it('refuses a typed point outside close-up and navigation too', () => {
    reset('welcome')
    store.getState().openCoordinateTable(gale, 'typed')
    expect(store.getState().coordinateTable).toBeNull()
  })

  it('closes', () => {
    store.getState().openCoordinateTable(gale, 'pick')
    store.getState().closeCoordinateTable()
    expect(store.getState().coordinateTable).toBeNull()
  })

  it.each([
    ['latitude past the pole', { latitude: 91, longitudeEast: 10 }],
    ['longitude out of range', { latitude: 0, longitudeEast: 360 }],
    ['NaN', { latitude: Number.NaN, longitudeEast: 10 }],
  ])('refuses an invalid coordinate: %s', (_, point) => {
    store.getState().openCoordinateTable(gale, 'pick')
    store.getState().openCoordinateTable(point, 'pick')
    expect(store.getState().coordinateTable).toEqual({ point: gale, source: 'pick' })
  })

  it.each(['welcome', 'surface'] as const)('refuses to open in %s', (mode) => {
    reset(mode)
    store.getState().openCoordinateTable(gale, 'pick')
    expect(store.getState().coordinateTable).toBeNull()
  })

  it('stays open between close-up and navigation', () => {
    store.getState().openCoordinateTable(gale, 'pick')
    store.setState({ viewMode: 'navigation' })
    store.getState().endNavigation()
    expect(store.getState().viewMode).toBe('close-up')
    expect(store.getState().coordinateTable).toEqual({ point: gale, source: 'pick' })
  })

  it('closes on a move to welcome', () => {
    store.getState().openCoordinateTable(gale, 'pick')
    store.getState().setViewMode('welcome')
    expect(store.getState().viewMode).toBe('welcome')
    expect(store.getState().coordinateTable).toBeNull()
  })

  it('closes on entering surface', () => {
    store.getState().openCoordinateTable(gale, 'pick')
    store.getState().enterSurface(jezero)
    expect(store.getState().viewMode).toBe('surface')
    expect(store.getState().coordinateTable).toBeNull()
  })

  it('stays open when a move is refused', () => {
    reset('navigation')
    store.getState().openCoordinateTable(gale, 'pick')
    store.getState().setViewMode('welcome')
    expect(store.getState().viewMode).toBe('navigation')
    expect(store.getState().coordinateTable).toEqual({ point: gale, source: 'pick' })
  })
})
